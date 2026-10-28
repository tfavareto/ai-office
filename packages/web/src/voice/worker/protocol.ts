// Messages between the voice input (main thread) and the Whisper worker. Audio travels as 16 kHz mono Float32.

/** Whisper's language codes for the app's languages; null lets the model detect the language. */
export type WhisperLanguage = 'pt' | 'en' | 'es';

export type WorkerRequest =
  | { type: 'load'; model: string; baseUrl: string }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: WhisperLanguage | null };

export type WorkerErrorCode = 'load' | 'transcribe';

export type WorkerResponse =
  /** 0..1 of the model files read and prepared. */
  | { type: 'progress'; progress: number }
  | { type: 'ready'; loadMs: number }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; id: number | null; code: WorkerErrorCode };

/** The part of a Worker the voice input uses (a fake one stands in for it in tests). */
export interface WhisperWorker {
  post(message: WorkerRequest, transfer?: Transferable[]): void;
  onMessage(listener: (message: WorkerResponse) => void): void;
  onFailure(listener: () => void): void;
  terminate(): void;
}
