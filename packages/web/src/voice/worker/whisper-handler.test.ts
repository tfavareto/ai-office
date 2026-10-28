import { describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from './protocol';
import { createWhisperHandler, maxNewTokens, options, type Transcriber, type WhisperRuntime } from './whisper-handler';

const SECOND = 16_000;

function setup(transcriber: Transcriber, loadFails = false) {
  const posted: WorkerResponse[] = [];
  const load = vi.fn((_model: string, _baseUrl: string, onProgress: (p: number) => void) => {
    onProgress(0.5);
    return loadFails ? Promise.reject(new Error('no model')) : Promise.resolve(transcriber);
  });
  const runtime: WhisperRuntime = { load };
  let clock = 0;
  const handle = createWhisperHandler(
    runtime,
    (message) => posted.push(message),
    () => (clock += 25),
  );
  return { handle, posted, load };
}

const echo = vi.fn((_audio: Float32Array, _options: Record<string, unknown>) => Promise.resolve({ text: ' olá ' }));

describe('whisper handler', () => {
  it('loads the model from the given address, reporting progress, then says it is ready', async () => {
    const { handle, posted, load } = setup(echo as unknown as Transcriber);

    await handle({ type: 'load', model: 'whisper-base', baseUrl: '/api/voice/model/' });

    expect(load.mock.calls[0]?.slice(0, 2)).toEqual(['whisper-base', '/api/voice/model/']);
    expect(posted).toEqual([
      { type: 'progress', progress: 0.5 },
      { type: 'ready', loadMs: 25 },
    ]);
  });

  it('loads once even when asked twice', async () => {
    const { handle, load } = setup(echo as unknown as Transcriber);

    await handle({ type: 'load', model: 'whisper-base', baseUrl: '/m/' });
    await handle({ type: 'load', model: 'whisper-base', baseUrl: '/m/' });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports a model that fails to load, and can try again', async () => {
    const { handle, posted, load } = setup(echo as unknown as Transcriber, true);

    await handle({ type: 'load', model: 'whisper-base', baseUrl: '/m/' });
    await handle({ type: 'load', model: 'whisper-base', baseUrl: '/m/' });

    expect(posted.filter((message) => message.type === 'error')).toEqual([
      { type: 'error', id: null, code: 'load' },
      { type: 'error', id: null, code: 'load' },
    ]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('transcribes with the language and returns the trimmed text with how long it took', async () => {
    const { handle, posted } = setup(echo as unknown as Transcriber);
    await handle({ type: 'load', model: 'whisper-base', baseUrl: '/m/' });
    posted.length = 0;

    await handle({ type: 'transcribe', id: 7, audio: new Float32Array(2 * SECOND), language: 'pt' });

    expect(posted).toEqual([{ type: 'result', id: 7, text: 'olá', ms: 25 }]);
    expect(echo.mock.calls.at(-1)?.[1]).toMatchObject({ task: 'transcribe', language: 'pt', return_timestamps: false });
  });

  it('joins the parts when the model answers with several', async () => {
    const parts = vi.fn(() => Promise.resolve([{ text: 'um' }, { text: 'dois' }]));
    const { handle, posted } = setup(parts as unknown as Transcriber);
    await handle({ type: 'load', model: 'whisper-base', baseUrl: '/m/' });

    await handle({ type: 'transcribe', id: 1, audio: new Float32Array(SECOND), language: null });

    expect(posted.at(-1)).toMatchObject({ type: 'result', text: 'um dois' });
  });

  it('reports a transcription that throws, and one asked before the model is loaded', async () => {
    const broken = vi.fn(() => Promise.reject(new Error('boom')));
    const { handle, posted } = setup(broken as unknown as Transcriber);

    await handle({ type: 'transcribe', id: 1, audio: new Float32Array(SECOND), language: null });
    await handle({ type: 'load', model: 'whisper-base', baseUrl: '/m/' });
    await handle({ type: 'transcribe', id: 2, audio: new Float32Array(SECOND), language: null });

    expect(posted.filter((message) => message.type === 'error')).toEqual([
      { type: 'error', id: 1, code: 'transcribe' },
      { type: 'error', id: 2, code: 'transcribe' },
    ]);
  });
});

describe('transcription options', () => {
  it('lets the model detect the language when none is given', () => {
    expect(options(null, SECOND)).not.toHaveProperty('language');
  });

  it('cuts only long audio into overlapping windows', () => {
    expect(options('en', 30 * SECOND)).not.toHaveProperty('chunk_length_s');
    expect(options('en', 31 * SECOND)).toMatchObject({ chunk_length_s: 30, stride_length_s: 5 });
  });

  it('caps the words by the length of the audio, within limits', () => {
    expect(maxNewTokens(SECOND / 10)).toBe(32);
    expect(maxNewTokens(5 * SECOND)).toBe(40);
    expect(maxNewTokens(30 * SECOND)).toBe(240);
    expect(maxNewTokens(60 * SECOND)).toBe(240);
  });
});
