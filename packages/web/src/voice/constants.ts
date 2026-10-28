// Numbers shared by the recorder, the voice input and the worker.

/** Whisper listens at 16 kHz. */
export const WHISPER_SAMPLE_RATE = 16_000;
/** A take stops being recorded after this long (the microphone is released; the person then stops it to transcribe). */
export const MAX_RECORDING_MS = 60_000;
/** Shorter takes are treated as a slip of the finger: nothing is transcribed. */
export const MIN_RECORDING_MS = 400;
/** Below this peak (0..1) a take is silence: nothing is transcribed. */
export const SILENCE_PEAK = 0.005;
/** The model leaves memory after this long without use; it loads again, quickly, on the next take. */
export const MODEL_IDLE_MS = 5 * 60_000;
/** How often the download progress is read from the server. */
export const DOWNLOAD_POLL_MS = 600;
/** Where the page loads the model files from (served by AI Office from `<state dir>/models/`). */
export const MODEL_BASE_URL = '/api/voice/model/';
/** Name the audio worklet registers its processor under. */
export const CAPTURE_PROCESSOR_NAME = 'ai-office-capture';
