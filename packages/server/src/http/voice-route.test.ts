// Voice input through the HTTP API: status, the one-time download, removal and the files served to the page.
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { API, type VoiceStatusResponse } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import { freePort, makeTempDir, removeDir } from '../test-helpers';
import { specBytes, type VoiceModelSpec } from '../voice/manifest';
import { fakeModels, fakeSource, startFakeHub, type FakeHub } from '../voice/testkit';

let state: string;
let web: string;
let hub: FakeHub;
let specs: ReturnType<typeof fakeModels>['specs'];
let served: ReturnType<typeof fakeModels>['served'];
let app: App;

async function boot(env: Record<string, string> = {}): Promise<void> {
  const port = await freePort();
  const config = loadConfig(
    { HOME: state, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...env },
    [],
    web,
  );
  app = createApp(config, silentLogger, {
    version: '9.9.9',
    voice: { fetchImpl: fetch, source: fakeSource(hub), specs, freeBytes: () => Promise.resolve(undefined) },
  });
  await app.start();
}

beforeEach(async () => {
  state = join(await makeTempDir('ai-office-voice-'), 'state');
  web = join(await makeTempDir('ai-office-web-'), 'dist');
  ({ specs, served } = fakeModels());
  hub = await startFakeHub(served);
});
afterEach(async () => {
  await app.stop();
  await hub.close();
  await removeDir(join(state, '..'));
  await removeDir(join(web, '..'));
});

const base = (): string => `http://127.0.0.1:${app.port()}`;
const authed = (): Record<string, string> => ({ authorization: `Bearer ${app.context.auth.value}` });
const get = (path: string, headers: Record<string, string> = authed()): Promise<Response> =>
  fetch(`${base()}${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = authed()): Promise<Response> =>
  fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const del = (path: string, headers: Record<string, string> = authed()): Promise<Response> =>
  fetch(`${base()}${path}`, { method: 'DELETE', headers });

const status = async (): Promise<VoiceStatusResponse> =>
  (await (await get(`${API.voice}/status`)).json()) as VoiceStatusResponse;
const modelStatus = async (size: string) => (await status()).models.find((model) => model.size === size);

async function download(size: string): Promise<void> {
  expect((await post(`${API.voice}/download`, { size })).status).toBe(202);
  await app.context.voice.settled(size as 'base');
}

/** GET with a hand-made path, so `..` and `%2e` reach the server as they are. */
function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(base());
    const req = request({ host: url.hostname, port: url.port, path, headers: authed() }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/voice/status', () => {
  test('lists the models that can be downloaded and their sizes', async () => {
    await boot();

    const body = await status();

    expect(body.enabled).toBe(true);
    expect(body.models.map((model) => [model.size, model.state])).toEqual([
      ['tiny', 'missing'],
      ['base', 'missing'],
      ['small', 'missing'],
    ]);
    expect(body.models[1]?.bytes).toBe(specBytes(specs.base as VoiceModelSpec));
  });

  test('needs the access token', async () => {
    await boot();

    expect((await get(`${API.voice}/status`, {})).status).toBe(401);
  });

  test('is local only', async () => {
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });

    const response = await get(`${API.voice}/status`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'local-only' });
  });

  test('refuses cross-site requests', async () => {
    await boot();

    expect((await get(`${API.voice}/status`, { ...authed(), 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});

describe('POST /api/voice/download', () => {
  test('downloads the model only when asked, then reports it ready', async () => {
    await boot();
    expect(hub.requests).toEqual([]);

    await download('base');

    expect(await modelStatus('base')).toMatchObject({ state: 'ready', downloadedBytes: specBytes(specs.base) });
    expect(await modelStatus('tiny')).toMatchObject({ state: 'missing' });
  });

  test.each([{}, { size: 'huge' }, { size: 3 }, { size: '../base' }])('rejects %j', async (body) => {
    await boot();

    const response = await post(`${API.voice}/download`, body);

    expect(response.status).toBe(400);
    expect(hub.requests).toEqual([]);
  });

  test('answers 409 while another model downloads', async () => {
    await boot();
    hub.override(`/${specs.base.repo}/resolve/${specs.base.revision}/config.json`, () => undefined);
    await post(`${API.voice}/download`, { size: 'base' });

    const response = await post(`${API.voice}/download`, { size: 'tiny' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'voice-busy' });
    await del(`${API.voice}/model/whisper-base`);
  });

  test('answers 409 and downloads nothing when voice is turned off', async () => {
    await boot({ AI_OFFICE_VOICE: '0' });

    const response = await post(`${API.voice}/download`, { size: 'base' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'voice-disabled' });
    expect((await status()).enabled).toBe(false);
    expect(hub.requests).toEqual([]);
  });

  test('is local only and needs the token and a JSON body', async () => {
    await boot();

    expect((await post(`${API.voice}/download`, { size: 'base' }, {})).status).toBe(401);
    const text = await fetch(`${base()}${API.voice}/download`, {
      method: 'POST',
      headers: { ...authed(), 'content-type': 'text/plain' },
      body: '{"size":"base"}',
    });
    expect(text.status).toBe(415);
    expect(hub.requests).toEqual([]);
  });
});

describe('GET /api/voice/model/<id>/<file>', () => {
  test('serves the files of a downloaded model, with their exact bytes and no caching', async () => {
    await boot();
    await download('base');
    const encoder = specs.base.files.find((file) => file.path.endsWith('encoder_model_quantized.onnx'));

    const config = await get(`${API.voice}/model/whisper-base/config.json`);
    const onnx = await get(`${API.voice}/model/whisper-base/onnx/encoder_model_quantized.onnx`);

    expect(config.status).toBe(200);
    expect(config.headers.get('content-type')).toContain('application/json');
    expect(config.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await config.arrayBuffer())).toEqual(
      served.get(`/${specs.base.repo}/resolve/${specs.base.revision}/config.json`),
    );
    expect(onnx.status).toBe(200);
    expect(onnx.headers.get('content-length')).toBe(String(encoder?.bytes));
    expect(onnx.headers.get('content-type')).toBe('application/octet-stream');
    expect((await onnx.arrayBuffer()).byteLength).toBe(encoder?.bytes);
  });

  test("answers a range request with just those bytes, as the page does to learn a file's size", async () => {
    await boot();
    await download('tiny');
    const whole = served.get(`/${specs.tiny.repo}/resolve/${specs.tiny.revision}/tokenizer.json`) as Buffer;

    const first = await get(`${API.voice}/model/whisper-tiny/tokenizer.json`, { ...authed(), range: 'bytes=0-0' });
    const tail = await get(`${API.voice}/model/whisper-tiny/tokenizer.json`, { ...authed(), range: 'bytes=10-' });
    const beyond = await get(`${API.voice}/model/whisper-tiny/tokenizer.json`, { ...authed(), range: 'bytes=99999-' });

    expect(first.status).toBe(206);
    expect(first.headers.get('content-range')).toBe(`bytes 0-0/${whole.length}`);
    expect(Buffer.from(await first.arrayBuffer())).toEqual(whole.subarray(0, 1));
    expect(tail.status).toBe(206);
    expect(Buffer.from(await tail.arrayBuffer())).toEqual(whole.subarray(10));
    expect(beyond.status).toBe(416);
  });

  test('answers HEAD with the length and no body', async () => {
    await boot();
    await download('tiny');

    const response = await fetch(`${base()}${API.voice}/model/whisper-tiny/config.json`, {
      method: 'HEAD',
      headers: authed(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe(String(specs.tiny.files[0]?.bytes));
    expect(await response.text()).toBe('');
  });

  test('does not serve a model that was not downloaded', async () => {
    await boot();

    expect((await get(`${API.voice}/model/whisper-base/config.json`)).status).toBe(404);
  });

  test('needs the access token', async () => {
    await boot();
    await download('tiny');

    expect((await get(`${API.voice}/model/whisper-tiny/config.json`, {})).status).toBe(401);
  });

  test('is local only', async () => {
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });

    expect((await get(`${API.voice}/model/whisper-tiny/config.json`)).status).toBe(403);
  });

  test.each([
    '/api/voice/model/whisper-tiny/../../../token',
    '/api/voice/model/whisper-tiny/%2e%2e/%2e%2e/token',
    '/api/voice/model/whisper-tiny/..%2f..%2ftoken',
    '/api/voice/model/whisper-tiny/onnx/..%2fconfig.json',
    '/api/voice/model/whisper-tiny/onnx/%2e%2e%2fmodel.json',
    '/api/voice/model/..%2f/config.json',
    '/api/voice/model/whisper-tiny/model.json',
    '/api/voice/model/whisper-tiny/extra.json',
    '/api/voice/model/whisper-tiny/onnx/other.onnx',
    '/api/voice/model/whisper-tiny/onnx/encoder_model_quantized.onnx.part',
    '/api/voice/model/whisper-tiny/%00',
    '/api/voice/model/whisper-large/config.json',
    '/api/voice/model/token/config.json',
    '/api/voice/model/whisper-tiny/onnx/x/config.json',
  ])('finds nothing at %s', async (path) => {
    await boot();
    await download('tiny');

    const response = await rawGet(path);

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(response.body).not.toContain(app.context.auth.value);
  });
});

describe('DELETE /api/voice/model/<id>', () => {
  test('removes the model and answers the new status', async () => {
    await boot();
    await download('tiny');

    const response = await del(`${API.voice}/model/whisper-tiny`);

    expect(response.status).toBe(200);
    expect(((await response.json()) as VoiceStatusResponse).models[0]?.state).toBe('missing');
    expect((await get(`${API.voice}/model/whisper-tiny/config.json`)).status).toBe(404);
  });

  test('answers 404 for a model that does not exist', async () => {
    await boot();

    expect((await del(`${API.voice}/model/whisper-huge`)).status).toBe(404);
  });

  test('needs the access token', async () => {
    await boot();

    expect((await del(`${API.voice}/model/whisper-tiny`, {})).status).toBe(401);
  });
});
