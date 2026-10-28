// What the Whisper worker does with its messages, apart from the worker plumbing: load a model, transcribe audio.
// `runtime` is transformers.js in the real worker and a fake in tests.
import type { WhisperLanguage, WorkerRequest, WorkerResponse } from './protocol';

/** Audio longer than one Whisper window is cut into overlapping windows of this length. */
const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;
const SAMPLE_RATE = 16_000;
/**
 * A cap on the words the model may write per window, so a take it cannot make sense of ends in seconds instead of
 * looping to Whisper's limit: a generous 8 tokens per second of audio (speech is 3 to 5), at least 32.
 */
const TOKENS_PER_SECOND = 8;
const MIN_NEW_TOKENS = 32;
const MAX_NEW_TOKENS = 440;

export interface Transcriber {
  (audio: Float32Array, options: Record<string, unknown>): Promise<{ text: string } | { text: string }[]>;
  dispose?: () => Promise<void> | void;
}

export interface WhisperRuntime {
  /** Loads the model from `baseUrl` (this server) and reports 0..1 as its files arrive. */
  load(model: string, baseUrl: string, onProgress: (progress: number) => void): Promise<Transcriber>;
}

function textOf(output: { text: string } | { text: string }[]): string {
  return (Array.isArray(output) ? output.map((part) => part.text).join(' ') : output.text).trim();
}

export function maxNewTokens(samples: number): number {
  const seconds = Math.min(samples, CHUNK_SECONDS * SAMPLE_RATE) / SAMPLE_RATE;
  return Math.min(MAX_NEW_TOKENS, Math.max(MIN_NEW_TOKENS, Math.ceil(seconds * TOKENS_PER_SECOND)));
}

export function options(language: WhisperLanguage | null, samples: number): Record<string, unknown> {
  return {
    task: 'transcribe',
    max_new_tokens: maxNewTokens(samples),
    ...(language !== null ? { language } : {}),
    return_timestamps: false,
    ...(samples > CHUNK_SECONDS * SAMPLE_RATE
      ? { chunk_length_s: CHUNK_SECONDS, stride_length_s: STRIDE_SECONDS }
      : {}),
  };
}

export function createWhisperHandler(
  runtime: WhisperRuntime,
  post: (message: WorkerResponse) => void,
  now: () => number,
): (message: WorkerRequest) => Promise<void> {
  let transcriber: Transcriber | undefined;
  let loading: Promise<Transcriber> | undefined;

  async function load(model: string, baseUrl: string): Promise<void> {
    const started = now();
    try {
      loading ??= runtime.load(model, baseUrl, (progress) => post({ type: 'progress', progress }));
      transcriber = await loading;
      post({ type: 'ready', loadMs: Math.round(now() - started) });
    } catch {
      loading = undefined;
      post({ type: 'error', id: null, code: 'load' });
    }
  }

  async function transcribe(id: number, audio: Float32Array, language: WhisperLanguage | null): Promise<void> {
    if (transcriber === undefined) return post({ type: 'error', id, code: 'transcribe' });
    const started = now();
    try {
      const output = await transcriber(audio, options(language, audio.length));
      post({ type: 'result', id, text: textOf(output), ms: Math.round(now() - started) });
    } catch {
      post({ type: 'error', id, code: 'transcribe' });
    }
  }

  return (message) =>
    message.type === 'load'
      ? load(message.model, message.baseUrl)
      : transcribe(message.id, message.audio, message.language);
}
