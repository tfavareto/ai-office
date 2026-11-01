import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { voiceModelId, type VoiceModelSize } from '@ai-office/shared';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { specBytes, type VoiceModelSpec } from './manifest';
import {
  DOWNLOAD_DEADLINE_MS,
  downloadDeadlineMs,
  MODEL_MARKER,
  MODELS_DIR,
  VoiceModelStore,
  type VoiceModelStoreOptions,
} from './model-store';
import { fakeModels, fakeSource, serveWithRange, startFakeHub, type FakeHub } from './testkit';

let state: string;
let hub: FakeHub;
let specs: Record<VoiceModelSize, VoiceModelSpec>;
let served: Map<string, Buffer>;
let stores: VoiceModelStore[];

const dirOf = (size: VoiceModelSize): string => join(state, MODELS_DIR, voiceModelId(size));
const urlPath = (size: VoiceModelSize, file: string): string =>
  `/${specs[size].repo}/resolve/${specs[size].revision}/${file}`;
const lastFile = (size: VoiceModelSize): string => specs[size].files.at(-1)?.path ?? '';

function makeStore(extra: Partial<VoiceModelStoreOptions> = {}): VoiceModelStore {
  const store = new VoiceModelStore({
    stateDir: state,
    log: silentLogger,
    fetchImpl: fetch,
    source: fakeSource(hub),
    specs,
    freeBytes: () => Promise.resolve(undefined),
    ...extra,
  });
  stores.push(store);
  return store;
}

async function statusOf(store: VoiceModelStore, size: VoiceModelSize) {
  const response = await store.status();
  const model = response.models.find((candidate) => candidate.size === size);
  if (model === undefined) throw new Error('missing model status');
  return model;
}

beforeEach(async () => {
  state = join(await makeTempDir('ai-office-voice-'), 'state');
  ({ specs, served } = fakeModels());
  hub = await startFakeHub(served);
  stores = [];
});
afterEach(async () => {
  await Promise.all(stores.map((store) => store.stop()));
  await hub.close();
  await removeDir(join(state, '..'));
});

describe('status', () => {
  test('lists every size as missing, with their download size, before anything is downloaded', async () => {
    const response = await makeStore().status();

    expect(response.enabled).toBe(true);
    expect(response.models.map((model) => [model.size, model.id, model.state, model.downloadedBytes])).toEqual([
      ['tiny', 'whisper-tiny', 'missing', 0],
      ['base', 'whisper-base', 'missing', 0],
      ['small', 'whisper-small', 'missing', 0],
      ['turbo', 'whisper-large-v3-turbo', 'missing', 0],
    ]);
    expect(response.models[1]?.bytes).toBe(specBytes(specs.base));
  });

  test('does not touch the network or the disk until a download is asked for', async () => {
    await makeStore().status();

    expect(hub.requests).toEqual([]);
    await expect(stat(join(state, MODELS_DIR))).rejects.toThrow();
  });
});

describe('download', () => {
  test('downloads every file of the model, verifies it and marks it ready', async () => {
    const store = makeStore();

    expect(store.start('base')).toBe('started');
    await store.settled('base');

    const model = await statusOf(store, 'base');
    expect(model.state).toBe('ready');
    expect(model.downloadedBytes).toBe(specBytes(specs.base));
    for (const file of specs.base.files)
      expect((await readFile(join(dirOf('base'), file.path))).length, file.path).toBe(file.bytes);
    expect(JSON.parse(await readFile(join(dirOf('base'), MODEL_MARKER), 'utf8'))).toMatchObject({
      size: 'base',
      revision: specs.base.revision,
    });
    // Nothing else was downloaded.
    expect((await statusOf(store, 'tiny')).state).toBe('missing');
    expect(hub.requests.every((request) => request.path.includes('whisper-base'))).toBe(true);
  });

  test('keeps the folders private (0700) and the files too (0600)', async () => {
    const store = makeStore();
    store.start('tiny');
    await store.settled('tiny');

    expect((await stat(join(state, MODELS_DIR))).mode & 0o777).toBe(0o700);
    expect((await stat(dirOf('tiny'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dirOf('tiny'), 'onnx'))).mode & 0o777).toBe(0o700);
    for (const file of [MODEL_MARKER, ...specs.tiny.files.map((spec) => spec.path)])
      expect((await stat(join(dirOf('tiny'), file))).mode & 0o777, file).toBe(0o600);
  });

  test('reports progress while the files arrive', async () => {
    const lastPath = urlPath('base', lastFile('base'));
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    hub.override(lastPath, (req, res, body) => {
      void gate.then(() => serveWithRange(req, res, body));
    });
    const store = makeStore();
    const total = specBytes(specs.base);
    const lastBytes = specs.base.files.at(-1)?.bytes ?? 0;

    store.start('base');
    await expect
      .poll(async () => (await statusOf(store, 'base')).downloadedBytes, { timeout: 10_000 })
      .toBe(total - lastBytes);
    const during = await statusOf(store, 'base');
    release();
    await store.settled('base');

    expect(during.state).toBe('downloading');
    expect((await statusOf(store, 'base')).downloadedBytes).toBe(total);
  });

  test('joins a download that is running and refuses a second model meanwhile', async () => {
    hub.override(urlPath('base', 'config.json'), () => undefined);
    const store = makeStore({ connectTimeoutMs: 5000 });

    expect(store.start('base')).toBe('started');
    expect(store.start('base')).toBe('running');
    expect(store.start('tiny')).toBe('busy');
    await store.remove('base');
  });

  test('leaves a model that is already there alone', async () => {
    const store = makeStore();
    store.start('tiny');
    await store.settled('tiny');
    hub.requests.length = 0;

    store.start('tiny');
    await store.settled('tiny');

    expect(hub.requests).toEqual([]);
    expect((await statusOf(store, 'tiny')).state).toBe('ready');
  });

  test('does nothing when voice is turned off', async () => {
    const store = makeStore({ disabled: true });

    expect(store.start('base')).toBe('disabled');
    expect((await store.status()).enabled).toBe(false);
    expect(hub.requests).toEqual([]);
  });

  test('says why a download failed, and a new try continues instead of starting over', async () => {
    const tail = urlPath('base', lastFile('base'));
    const original = served.get(tail) as Buffer;
    hub.override(tail, (_req, res) => {
      res.writeHead(200, { 'Content-Length': original.length });
      res.write(original.subarray(0, 100));
      setTimeout(() => res.destroy(), 10);
    });
    const store = makeStore();

    store.start('base');
    await store.settled('base');
    const failed = await statusOf(store, 'base');
    expect(failed).toMatchObject({ state: 'error', error: 'network' });

    hub.override(tail, serveWithRange);
    hub.requests.length = 0;
    store.start('base');
    await store.settled('base');

    expect((await statusOf(store, 'base')).state).toBe('ready');
    // The finished files were not asked for again; the last one continued from the 100 bytes that had arrived.
    expect(hub.requests).toEqual([{ path: tail, range: 'bytes=100-' }]);
  });

  test('refuses files that are not the pinned ones and leaves no model behind', async () => {
    const path = urlPath('tiny', 'tokenizer.json');
    const wrong = Buffer.alloc(served.get(path)?.length ?? 0, 'x');
    hub.override(path, (req, res) => serveWithRange(req, res, wrong));
    const store = makeStore();

    store.start('tiny');
    await store.settled('tiny');

    expect(await statusOf(store, 'tiny')).toMatchObject({ state: 'error', error: 'integrity' });
    expect(await readdir(dirOf('tiny'))).not.toContain(MODEL_MARKER);
    expect(await store.file('tiny', 'config.json')).toBeUndefined();
  });

  test('refuses to start when the disk has no room', async () => {
    const store = makeStore({ freeBytes: () => Promise.resolve(10) });

    store.start('base');
    await store.settled('base');

    expect(await statusOf(store, 'base')).toMatchObject({ state: 'error', error: 'disk' });
    expect(hub.requests).toEqual([]);
  });

  test('gives up after the deadline', async () => {
    hub.override(urlPath('tiny', 'config.json'), (_req, res, body) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.write('x');
    });
    const store = makeStore({ deadlineMs: 150, idleTimeoutMs: 10_000 });

    store.start('tiny');
    await store.settled('tiny');

    expect(await statusOf(store, 'tiny')).toMatchObject({ state: 'error', error: 'timeout' });
  });

  test('treats a model of another revision as missing and replaces it', async () => {
    const store = makeStore();
    store.start('tiny');
    await store.settled('tiny');
    const marker = join(dirOf('tiny'), MODEL_MARKER);
    await writeFile(marker, JSON.stringify({ ...JSON.parse(await readFile(marker, 'utf8')), revision: 'old' }));

    expect((await statusOf(store, 'tiny')).state).toBe('missing');
    store.start('tiny');
    await store.settled('tiny');

    expect((await statusOf(store, 'tiny')).state).toBe('ready');
  });

  test('treats a model with a file of the wrong size as missing', async () => {
    const store = makeStore();
    store.start('tiny');
    await store.settled('tiny');
    await writeFile(join(dirOf('tiny'), 'config.json'), 'tampered');

    expect((await statusOf(store, 'tiny')).state).toBe('missing');
  });
});

describe('deadline', () => {
  test('gives a model an hour, and a large one the time it needs at 300 kB/s', () => {
    expect(downloadDeadlineMs(80e6)).toBe(DOWNLOAD_DEADLINE_MS);
    expect(downloadDeadlineMs(1.62e9)).toBe(5400_000);
  });
});

describe('remove', () => {
  test('deletes the model and its folder', async () => {
    const store = makeStore();
    store.start('tiny');
    await store.settled('tiny');

    await store.remove('tiny');

    expect((await statusOf(store, 'tiny')).state).toBe('missing');
    await expect(stat(dirOf('tiny'))).rejects.toThrow();
  });

  test('stops a download in progress and leaves nothing of it', async () => {
    hub.override(urlPath('base', 'config.json'), (_req, res, body) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.write('x');
    });
    const store = makeStore();
    store.start('base');
    await expect.poll(() => hub.requests.length).toBeGreaterThan(0);

    await store.remove('base');

    expect(await statusOf(store, 'base')).toMatchObject({ state: 'missing', downloadedBytes: 0 });
    await expect(stat(dirOf('base'))).rejects.toThrow();
  });

  test('refuses a new download of the model while it is being removed, then accepts it', async () => {
    hub.override(urlPath('base', 'config.json'), (_req, res, body) => {
      res.writeHead(200, { 'Content-Length': body.length });
      res.write('x');
    });
    const store = makeStore();
    store.start('base');
    await expect.poll(() => hub.requests.length).toBeGreaterThan(0);

    const removal = store.remove('base');
    const during = store.start('base');
    const again = store.remove('base');
    await removal;

    expect(during).toBe('busy');
    expect(again).toBe(removal);
    await expect(stat(dirOf('base'))).rejects.toThrow();
    expect(store.start('base')).toBe('started');
    await store.remove('base');
  });

  test('forgets an earlier failure', async () => {
    const store = makeStore({ freeBytes: () => Promise.resolve(1) });
    store.start('tiny');
    await store.settled('tiny');
    expect((await statusOf(store, 'tiny')).state).toBe('error');

    await store.remove('tiny');

    expect((await statusOf(store, 'tiny')).state).toBe('missing');
  });
});

describe('file', () => {
  test('finds the listed files of a ready model', async () => {
    const store = makeStore();
    store.start('tiny');
    await store.settled('tiny');

    const found = await store.file('tiny', 'onnx/encoder_model_quantized.onnx');

    expect(found).toEqual({
      path: join(dirOf('tiny'), 'onnx', 'encoder_model_quantized.onnx'),
      bytes: specs.tiny.files.find((file) => file.path.endsWith('encoder_model_quantized.onnx'))?.bytes,
    });
  });

  test('finds nothing for a model that is not ready', async () => {
    expect(await makeStore().file('tiny', 'config.json')).toBeUndefined();
  });

  test('never leaves the list of files, whatever the path says', async () => {
    const store = makeStore();
    store.start('tiny');
    await store.settled('tiny');
    await mkdir(join(state, 'models', 'secret'), { recursive: true });
    await writeFile(join(state, 'token'), 'secret');
    await writeFile(join(dirOf('tiny'), 'extra.json'), '{}');

    for (const path of [
      '../token',
      '../../token',
      'onnx/../config.json',
      './config.json',
      '/etc/passwd',
      'config.json/',
      'extra.json',
      'model.json',
      'onnx/encoder_model_quantized.onnx.part',
      '',
    ])
      expect(await store.file('tiny', path), path).toBeUndefined();
  });
});
