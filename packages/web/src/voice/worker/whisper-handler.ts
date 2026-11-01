// What the Whisper worker does with its messages, apart from the worker plumbing: load a model, transcribe audio.
// `runtime` is transformers.js in the real worker and a fake in tests.
import type { LoadRequest, WhisperDevice, WhisperLanguage, WorkerRequest, WorkerResponse } from './protocol';

/** Audio longer than one Whisper window is cut into overlapping windows of this length. */
const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;
const SAMPLE_RATE = 16_000;
/**
 * A cap on the words the model may write per window, so a take it cannot make sense of ends in seconds instead of
 * looping to Whisper's limit: 10 tokens per second of audio (fast Portuguese with code words is about 6), at least 48
 * (a short command full of names), at most 440 (Whisper writes 448 tokens per window, its prompt included).
 */
const TOKENS_PER_SECOND = 10;
const MIN_NEW_TOKENS = 48;
const MAX_NEW_TOKENS = 440;

/** The ONNX precision per part of the model: what the pinned files are (see the server's manifest). */
export type WhisperDtype = 'q8' | { encoder_model: 'fp16'; decoder_model_merged: 'q4' };

/**
 * On the graphics card (large-v3-turbo) the encoder runs in 16-bit floats, its full precision, and the decoder in 4-bit
 * weights; on the CPU (tiny, base, small) both are 8-bit.
 */
export function dtypeFor(device: WhisperDevice): WhisperDtype {
  return device === 'webgpu' ? { encoder_model: 'fp16', decoder_model_merged: 'q4' } : 'q8';
}

export interface Transcriber {
  (audio: Float32Array, options: Record<string, unknown>): Promise<{ text: string } | { text: string }[]>;
  dispose?: () => Promise<void> | void;
}

export interface WhisperRuntime {
  /** Loads the model from `request.baseUrl` (this server) on its device and reports 0..1 as its files arrive. */
  load(request: LoadRequest, dtype: WhisperDtype, onProgress: (progress: number) => void): Promise<Transcriber>;
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

  async function load(request: LoadRequest): Promise<void> {
    const started = now();
    try {
      loading ??= runtime.load(request, dtypeFor(request.device), (progress) => post({ type: 'progress', progress }));
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
    message.type === 'load' ? load(message) : transcribe(message.id, message.audio, message.language);
}
