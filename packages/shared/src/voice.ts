// Local voice input: the Whisper models the server can download once (never automatically) and what the page may ask
// about them. The audio itself never reaches the server: the browser transcribes it on this computer.

export const VOICE_MODEL_SIZES = ['tiny', 'base', 'small'] as const;
export type VoiceModelSize = (typeof VOICE_MODEL_SIZES)[number];

/** Good for Portuguese, Spanish and English at a size most computers handle. */
export const DEFAULT_VOICE_MODEL_SIZE: VoiceModelSize = 'base';

export function isVoiceModelSize(value: unknown): value is VoiceModelSize {
  return typeof value === 'string' && (VOICE_MODEL_SIZES as readonly string[]).includes(value);
}

/** Name of a model folder, and the id the page loads it by: `whisper-base`. */
export function voiceModelId(size: VoiceModelSize): string {
  return `whisper-${size}`;
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
