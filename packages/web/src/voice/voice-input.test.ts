import type { Locale, VoiceModelSize, VoiceModelState, VoiceModelStatus, VoiceStatusResponse } from '@ai-office/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORDING_MS, MODEL_BASE_URL, MODEL_IDLE_MS } from './constants';
import { VoiceDownloadError, type VoiceModels } from './models';
import { RecorderError, type Recorder, type RecorderProgress, type Recording } from './recorder';
import type { VoiceStatus } from './types';
import { createVoiceInputCore } from './voice-input';
import type { WhisperWorker, WorkerRequest, WorkerResponse } from './worker/protocol';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

class FakeWorker implements WhisperWorker {
  readonly posted: WorkerRequest[] = [];
  terminated = false;
  private message: (m: WorkerResponse) => void = () => undefined;
  private failure: () => void = () => undefined;
  /** What a load answers: 'ready' at once, or nothing (the test replies itself). */
  constructor(
    private readonly behavior: { load: 'ready' | 'manual' | 'fail'; transcribe: 'echo' | 'manual' | 'fail' },
  ) {}
  post(request: WorkerRequest): void {
    this.posted.push(request);
    if (request.type === 'load') {
      if (this.behavior.load === 'ready') queueMicrotask(() => this.message({ type: 'ready', loadMs: 5 }));
      if (this.behavior.load === 'fail') queueMicrotask(() => this.message({ type: 'error', id: null, code: 'load' }));
      return;
    }
    if (this.behavior.transcribe === 'echo')
      queueMicrotask(() => this.message({ type: 'result', id: request.id, text: '  abrir o projeto web  ', ms: 9 }));
    if (this.behavior.transcribe === 'fail')
      queueMicrotask(() => this.message({ type: 'error', id: request.id, code: 'transcribe' }));
  }
  onMessage(listener: (m: WorkerResponse) => void): void {
    this.message = listener;
  }
  onFailure(listener: () => void): void {
    this.failure = listener;
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: WorkerResponse): void {
    this.message(message);
  }
  crash(): void {
    this.failure();
  }
}

class FakeRecorder implements Recorder {
  recording = false;
  cancelled = 0;
  startError: RecorderError | undefined;
  take: Recording = { samples: new Float32Array(16_000).fill(0.2), durationMs: 1000 };
  private listener: (p: RecorderProgress) => void = () => undefined;
  start(): Promise<void> {
    if (this.startError !== undefined) return Promise.reject(this.startError);
    this.recording = true;
    return Promise.resolve();
  }
  stop(): Promise<Recording> {
    this.recording = false;
    return Promise.resolve(this.take);
  }
  cancel(): void {
    this.recording = false;
    this.cancelled++;
  }
  onProgress(listener: (p: RecorderProgress) => void): () => void {
    this.listener = listener;
    return () => undefined;
  }
  isRecording(): boolean {
    return this.recording;
  }
  emit(progress: RecorderProgress): void {
    this.listener(progress);
  }
}

class FakeModels implements VoiceModels {
  response: VoiceStatusResponse | null = null;
  downloads: VoiceModelSize[] = [];
  downloadResult: 'ready' | VoiceDownloadError = 'ready';
  private readonly listeners = new Set<() => void>();
  set(
    state: VoiceModelState,
    extra: Partial<VoiceModelStatus> = {},
    size: VoiceModelSize = 'base',
    enabled = true,
  ): void {
    const models: VoiceModelStatus[] = (['tiny', 'base', 'small'] as const).map((s) => ({
      size: s,
      id: `whisper-${s}`,
      bytes: 1000,
      state: s === size ? state : 'missing',
      downloadedBytes: s === size && state === 'ready' ? 1000 : 0,
      ...(s === size ? extra : {}),
    }));
    this.response = { enabled, models };
    for (const listener of [...this.listeners]) listener();
  }
  current(): VoiceStatusResponse | null {
    return this.response;
  }
  statusOf(size: VoiceModelSize): VoiceModelStatus | undefined {
    return this.response?.models.find((model) => model.size === size);
  }
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  refresh(): Promise<void> {
    return Promise.resolve();
  }
  download(size: VoiceModelSize): Promise<void> {
    this.downloads.push(size);
    this.set('downloading', { downloadedBytes: 400 }, size);
    const result = this.downloadResult;
    if (result === 'ready') return Promise.resolve().then(() => this.set('ready', {}, size));
    // What the server would say after the failure.
    if (result.code === 'cancelled') this.set('missing', {}, size);
    return Promise.reject(result);
  }
  remove(size: VoiceModelSize): Promise<void> {
    this.set('missing', {}, size);
    return Promise.resolve();
  }
}

interface Rig {
  input: ReturnType<typeof createVoiceInputCore>;
  models: FakeModels;
  recorder: FakeRecorder;
  workers: FakeWorker[];
  seen: VoiceStatus[];
  size: { current: VoiceModelSize };
  locale: { current: Locale };
}

function rig(
  options: {
    supported?: boolean;
    behavior?: { load: 'ready' | 'manual' | 'fail'; transcribe: 'echo' | 'manual' | 'fail' };
    model?: VoiceModelState;
  } = {},
): Rig {
  const models = new FakeModels();
  if (options.model !== undefined) models.set(options.model);
  const recorder = new FakeRecorder();
  const workers: FakeWorker[] = [];
  const size = { current: 'base' as VoiceModelSize };
  const sizeListeners = new Set<() => void>();
  const locale = { current: 'pt-BR' as Locale };
  const input = createVoiceInputCore({
    models,
    recorder,
    createWorker: () => {
      const worker = new FakeWorker(options.behavior ?? { load: 'ready', transcribe: 'echo' });
      workers.push(worker);
      return worker;
    },
    preference: {
      size: () => size.current,
      setSize: (next) => {
        size.current = next;
        for (const listener of [...sizeListeners]) listener();
      },
      onChange: (listener) => {
        sizeListeners.add(listener);
        return () => sizeListeners.delete(listener);
      },
    },
    locale: () => locale.current,
    supported: () => options.supported ?? true,
  });
  const seen: VoiceStatus[] = [];
  input.onStatus((status) => seen.push(status));
  return { input, models, recorder, workers, seen, size, locale };
}

/** The states in order, a state repeated with other details (progress) counted once. */
const states = (seen: readonly VoiceStatus[]): string[] =>
  seen.map((status) => status.state).filter((state, i, all) => state !== all[i - 1]);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('availability', () => {
  it('is unavailable, with the reason, when the browser cannot record or run workers', async () => {
    const { input, recorder } = rig({ supported: false });

    await input.prepare();
    await input.start();

    expect(input.status()).toEqual({ state: 'unavailable', errorKey: 'voice.error.unsupported' });
    expect(recorder.recording).toBe(false);
  });

  it('is unavailable when the server was started with voice turned off', () => {
    const { input, models } = rig();

    models.set('missing', {}, 'base', false);

    expect(input.status()).toEqual({ state: 'unavailable', errorKey: 'voice.error.disabled' });
  });

  it('is off until the model is on this computer, then ready', () => {
    const { input, models, seen } = rig();
    expect(input.status().state).toBe('off');

    models.set('ready');

    expect(input.status().state).toBe('ready');
    expect(states(seen)).toEqual(['ready']);
  });

  it('shows the progress of a download another part of the app started', () => {
    const { input, models } = rig();

    models.set('downloading', { downloadedBytes: 250 });

    expect(input.status()).toEqual({ state: 'downloading', progress: 0.25 });
  });

  it('goes back to off, and frees the model, when the model is removed', async () => {
    const { input, models, workers } = rig({ model: 'ready' });
    await input.prepare();

    models.set('missing');

    expect(input.status().state).toBe('off');
    expect(workers[0]?.terminated).toBe(true);
  });

  it('follows the size the person picked', () => {
    const { input, models, size } = rig({ model: 'ready' });
    size.current = 'small';

    models.set('missing', {}, 'small');

    expect(input.status().state).toBe('off');
  });
});

describe('prepare', () => {
  it('downloads the model once, loads it in a worker from this server and becomes ready', async () => {
    const { input, models, workers, seen } = rig({ model: 'missing' });

    await input.prepare();

    expect(models.downloads).toEqual(['base']);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.posted).toEqual([{ type: 'load', model: 'whisper-base', baseUrl: MODEL_BASE_URL }]);
    expect(states(seen)).toEqual(['downloading', 'loading', 'ready']);
    expect(input.status()).toEqual({ state: 'ready' });
  });

  it('does not download again when the model is already there', async () => {
    const { input, models } = rig({ model: 'ready' });

    await input.prepare();

    expect(models.downloads).toEqual([]);
    expect(input.status().state).toBe('ready');
  });

  it('shows the loading progress the worker reports', async () => {
    const { input, workers } = rig({ model: 'ready', behavior: { load: 'manual', transcribe: 'echo' } });
    const seen: VoiceStatus[] = [];
    input.onStatus((status) => seen.push(status));

    const preparing = input.prepare();
    await flush();
    workers[0]?.emit({ type: 'progress', progress: 0.4 });
    workers[0]?.emit({ type: 'ready', loadMs: 7 });
    await preparing;

    expect(seen.filter((status) => status.state === 'loading').map((status) => status.progress)).toEqual([0, 0.4]);
  });

  it.each([
    [new VoiceDownloadError('integrity'), 'voice.error.downloadIntegrity'],
    [new VoiceDownloadError('network'), 'voice.error.downloadNetwork'],
    [new VoiceDownloadError('disk'), 'voice.error.downloadDisk'],
    [new VoiceDownloadError('busy'), 'voice.error.downloadBusy'],
  ])('explains a failed download (%s)', async (failure, key) => {
    const { input, models } = rig({ model: 'missing' });
    models.downloadResult = failure;

    await input.prepare();

    expect(input.status()).toEqual({ state: 'error', errorKey: key });
  });

  it('goes back to off, without an error, when the download is cancelled', async () => {
    const { input, models } = rig({ model: 'missing' });
    models.downloadResult = new VoiceDownloadError('cancelled');

    await input.prepare();

    expect(input.status()).toEqual({ state: 'off' });
  });

  it('can be tried again after a failure', async () => {
    const { input, models } = rig({ model: 'missing' });
    models.downloadResult = new VoiceDownloadError('network');
    await input.prepare();
    models.downloadResult = 'ready';

    await input.prepare();

    expect(input.status().state).toBe('ready');
  });

  it('reports a model the browser could not load', async () => {
    const { input } = rig({ model: 'ready', behavior: { load: 'fail', transcribe: 'echo' } });

    await input.prepare();

    expect(input.status()).toEqual({ state: 'error', errorKey: 'voice.error.load' });
  });

  it('runs once when asked twice at the same time', async () => {
    const { input, models } = rig({ model: 'missing' });

    await Promise.all([input.prepare(), input.prepare()]);

    expect(models.downloads).toHaveLength(1);
  });
});

describe('recording and transcribing', () => {
  it('listens, then turns the take into text and goes back to ready', async () => {
    const { input, recorder, workers, seen } = rig({ model: 'ready' });
    await input.prepare();
    seen.length = 0;

    await input.start();
    expect(input.status()).toMatchObject({ state: 'listening', elapsedMs: 0, limitMs: MAX_RECORDING_MS });
    const text = await input.stop();

    expect(text).toBe('abrir o projeto web');
    expect(recorder.recording).toBe(false);
    expect(states(seen)).toEqual(['listening', 'transcribing', 'ready']);
    const request = workers[0]?.posted.at(-1);
    expect(request).toMatchObject({ type: 'transcribe', language: 'pt' });
    expect((request as Extract<WorkerRequest, { type: 'transcribe' }>).audio.length).toBe(16_000);
  });

  it('shows the level and the time of the take, and when it hit the limit', async () => {
    const { input, recorder } = rig({ model: 'ready' });
    await input.start();

    recorder.emit({ level: 0.6, elapsedMs: 2300, limitReached: false });
    expect(input.status()).toMatchObject({ state: 'listening', level: 0.6, elapsedMs: 2300 });
    recorder.emit({ level: 0, elapsedMs: MAX_RECORDING_MS, limitReached: true });

    expect(input.status()).toMatchObject({ elapsedMs: MAX_RECORDING_MS, limitReached: true });
    expect(await input.stop()).toBe('abrir o projeto web');
  });

  it('starts loading the model while the person talks', async () => {
    const { input, workers } = rig({ model: 'ready' });

    await input.start();

    expect(workers[0]?.posted[0]).toMatchObject({ type: 'load' });
  });

  it('waits for a model that is still loading when the take stops, showing the loading', async () => {
    const { input, workers, seen } = rig({ model: 'ready', behavior: { load: 'manual', transcribe: 'echo' } });
    await input.start();
    seen.length = 0;

    const stopping = input.stop();
    await flush();
    expect(input.status().state).toBe('loading');
    workers[0]?.emit({ type: 'progress', progress: 0.5 });
    workers[0]?.emit({ type: 'ready', loadMs: 1 });

    expect(await stopping).toBe('abrir o projeto web');
    expect(states(seen)).toEqual(['loading', 'transcribing', 'ready']);
  });

  it('speaks the language of the interface unless told otherwise', async () => {
    const { input, workers, locale } = rig({ model: 'ready' });
    const languageOfNextTake = async (): Promise<unknown> => {
      await input.start();
      await input.stop();
      return (workers[0]?.posted.at(-1) as Extract<WorkerRequest, { type: 'transcribe' }>).language;
    };

    expect(await languageOfNextTake()).toBe('pt');
    locale.current = 'es';
    expect(await languageOfNextTake()).toBe('es');
    input.setLanguage('en');
    expect(await languageOfNextTake()).toBe('en');
    input.setLanguage('auto');
    expect(await languageOfNextTake()).toBeNull();
  });

  it('transcribes nothing when the take is silent or a slip of the finger', async () => {
    const { input, recorder, workers } = rig({ model: 'ready' });
    await input.prepare();

    recorder.take = { samples: new Float32Array(16_000), durationMs: 1000 };
    await input.start();
    expect(await input.stop()).toBe('');
    recorder.take = { samples: new Float32Array(1600).fill(0.5), durationMs: 100 };
    await input.start();
    expect(await input.stop()).toBe('');

    expect(workers[0]?.posted.filter((request) => request.type === 'transcribe')).toEqual([]);
    expect(input.status().state).toBe('ready');
  });

  it('does nothing when asked to start or stop in the wrong state', async () => {
    const { input, recorder } = rig();

    await input.start();
    expect(await input.stop()).toBe('');

    expect(recorder.recording).toBe(false);
    expect(input.status().state).toBe('off');
  });

  it('answers a second stop with the same text', async () => {
    const { input } = rig({ model: 'ready' });
    await input.start();

    const [first, second] = await Promise.all([input.stop(), input.stop()]);

    expect(first).toBe('abrir o projeto web');
    expect(second).toBe(first);
  });

  it.each([
    ['denied', 'voice.error.denied'],
    ['no-device', 'voice.error.noDevice'],
    ['busy', 'voice.error.busy'],
    ['failed', 'voice.error.mic'],
  ] as const)('explains a microphone problem (%s)', async (code, key) => {
    const { input, recorder } = rig({ model: 'ready' });
    recorder.startError = new RecorderError(code);

    await input.start();

    expect(input.status()).toEqual({ state: 'error', errorKey: key });
  });

  it('records again after a microphone problem is fixed', async () => {
    const { input, recorder } = rig({ model: 'ready' });
    recorder.startError = new RecorderError('denied');
    await input.start();
    recorder.startError = undefined;

    await input.start();

    expect(input.status().state).toBe('listening');
  });

  it('reports a model that fails to load while the person was talking', async () => {
    const { input } = rig({ model: 'ready', behavior: { load: 'fail', transcribe: 'echo' } });
    await input.start();

    expect(await input.stop()).toBe('');

    expect(input.status()).toEqual({ state: 'error', errorKey: 'voice.error.load' });
  });

  it('reports a transcription that fails', async () => {
    const { input } = rig({ model: 'ready', behavior: { load: 'ready', transcribe: 'fail' } });
    await input.start();

    expect(await input.stop()).toBe('');

    expect(input.status()).toEqual({ state: 'error', errorKey: 'voice.error.transcribe' });
  });

  it('survives a worker that crashes and loads a new one on the next take', async () => {
    const { input, workers } = rig({ model: 'ready' });
    await input.prepare();
    workers[0]?.crash();

    await input.start();
    expect(await input.stop()).toBe('abrir o projeto web');

    expect(workers).toHaveLength(2);
  });

  it('loads the model of the size picked, dropping the one in memory', async () => {
    const { input, models, workers, size } = rig({ model: 'ready' });
    await input.prepare();
    size.current = 'small';
    models.set('ready', {}, 'small');

    await input.start();

    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.posted[0]).toMatchObject({ model: 'whisper-small' });
  });
});

describe('cancel', () => {
  it('drops the take, releases the microphone and goes back to ready', async () => {
    const { input, recorder, workers } = rig({ model: 'ready' });
    await input.start();

    input.cancel();

    expect(input.status().state).toBe('ready');
    expect(recorder.recording).toBe(false);
    expect(workers[0]?.posted.filter((request) => request.type === 'transcribe')).toEqual([]);
  });

  it('stops a transcription in progress and still works afterwards', async () => {
    const { input, workers } = rig({ model: 'ready', behavior: { load: 'ready', transcribe: 'manual' } });
    await input.start();
    const stopping = input.stop();
    await flush();
    expect(input.status().state).toBe('transcribing');

    input.cancel();

    expect(await stopping).toBe('');
    expect(input.status().state).toBe('ready');
    expect(workers[0]?.terminated).toBe(true);
    await input.start();
    expect(input.status().state).toBe('listening');
  });

  it('backs out of a start that is still waiting for the microphone permission', async () => {
    const { input, recorder } = rig({ model: 'ready' });
    let allow: () => void = () => undefined;
    recorder.start = () =>
      new Promise<void>((resolve) => {
        allow = () => resolve();
      });

    const starting = input.start();
    input.cancel();
    allow();
    await starting;

    expect(input.status().state).toBe('ready');
  });
});

describe('memory and lifetime', () => {
  it('frees the model after a while without use and loads it again for the next take', async () => {
    const { input, workers } = rig({ model: 'ready' });
    await input.prepare();

    await vi.advanceTimersByTimeAsync(MODEL_IDLE_MS + 10);
    expect(workers[0]?.terminated).toBe(true);
    expect(input.status().state).toBe('ready');
    await input.start();
    await input.stop();

    expect(workers).toHaveLength(2);
  });

  it('keeps the model while a take is in progress', async () => {
    const { input, workers } = rig({ model: 'ready' });
    await input.prepare();
    await input.start();

    await vi.advanceTimersByTimeAsync(MODEL_IDLE_MS * 2);

    expect(workers[0]?.terminated).toBe(false);
  });

  it('stops everything and goes quiet when disposed', async () => {
    const { input, recorder, workers, seen } = rig({ model: 'ready' });
    await input.start();
    seen.length = 0;

    input.dispose();
    await input.start();
    await input.prepare();

    expect(recorder.recording).toBe(false);
    expect(workers[0]?.terminated).toBe(true);
    expect(seen).toEqual([]);
  });

  it('stops notifying a listener that unsubscribed', () => {
    const { input, models } = rig();
    const listener = vi.fn();
    const off = input.onStatus(listener);
    off();

    models.set('ready');

    expect(listener).not.toHaveBeenCalled();
  });
});
