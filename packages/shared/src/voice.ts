// Local voice input: the Whisper models the server can download once (never automatically) and what the page may ask
// about them. The audio itself never reaches the server: the browser transcribes it on this computer.

/** From the lightest to the most accurate. `turbo` is Whisper large-v3-turbo, which runs on the graphics card (WebGPU). */
export const VOICE_MODEL_SIZES = ['tiny', 'base', 'small', 'turbo'] as const;
export type VoiceModelSize = (typeof VOICE_MODEL_SIZES)[number];

/** The most accurate model; a browser without WebGPU uses `small` in its place (the page decides). */
export const DEFAULT_VOICE_MODEL_SIZE: VoiceModelSize = 'turbo';

const MODEL_IDS: Readonly<Record<VoiceModelSize, string>> = {
  tiny: 'whisper-tiny',
  base: 'whisper-base',
  small: 'whisper-small',
  turbo: 'whisper-large-v3-turbo',
};

export function isVoiceModelSize(value: unknown): value is VoiceModelSize {
  return typeof value === 'string' && (VOICE_MODEL_SIZES as readonly string[]).includes(value);
}

/** Name of a model folder, and the id the page loads it by: `whisper-base`, `whisper-large-v3-turbo`. */
export function voiceModelId(size: VoiceModelSize): string {
  return MODEL_IDS[size];
}

/** The size behind a model id, or undefined when it is not one of ours. */
export function parseVoiceModelId(id: string): VoiceModelSize | undefined {
  return VOICE_MODEL_SIZES.find((size) => voiceModelId(size) === id);
}

export type VoiceModelState = 'missing' | 'downloading' | 'ready' | 'error';

/** Why a download stopped: the network, a timeout, a file that is not the pinned one, a wrong size or the disk. */
export type VoiceDownloadErrorCode = 'network' | 'timeout' | 'integrity' | 'size' | 'disk';

const DOWNLOAD_ERROR_CODES: readonly string[] = ['network', 'timeout', 'integrity', 'size', 'disk'];

export function isVoiceDownloadErrorCode(value: unknown): value is VoiceDownloadErrorCode {
  return typeof value === 'string' && DOWNLOAD_ERROR_CODES.includes(value);
}

export interface VoiceModelStatus {
  size: VoiceModelSize;
  /** `whisper-base`: the folder under `<state dir>/models/` and the name in the model routes. */
  id: string;
  /** Total download size, in bytes. */
  bytes: number;
  state: VoiceModelState;
  /** Bytes already on disk (all of `bytes` when ready). */
  downloadedBytes: number;
  /** Why the last download failed, when `state` is 'error'. */
  error?: VoiceDownloadErrorCode;
}

/** GET /api/voice/status, and the answer of every write. */
export interface VoiceStatusResponse {
  /** False when the server was started with AI_OFFICE_VOICE=0: nothing can be downloaded. */
  enabled: boolean;
  models: VoiceModelStatus[];
}
