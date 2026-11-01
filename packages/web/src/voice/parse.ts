// Defensive parsing of the answers of /api/voice.
import {
  VOICE_MODEL_SIZES,
  isVoiceDownloadErrorCode,
  voiceModelId,
  type VoiceModelState,
  type VoiceModelStatus,
  type VoiceStatusResponse,
} from '@ai-office/shared';
import { isRecord } from '../net/parse';

const STATES: readonly VoiceModelState[] = ['missing', 'downloading', 'ready', 'error'];

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseModel(data: unknown): VoiceModelStatus | undefined {
  if (!isRecord(data)) return undefined;
  const size = VOICE_MODEL_SIZES.find((candidate) => candidate === data.size);
  const bytes = count(data.bytes);
  const state = STATES.find((candidate) => candidate === data.state);
  if (size === undefined || bytes === undefined || state === undefined) return undefined;
  return {
    size,
    id: voiceModelId(size),
    bytes,
    state,
    downloadedBytes: Math.min(bytes, count(data.downloadedBytes) ?? 0),
    ...(isVoiceDownloadErrorCode(data.error) ? { error: data.error } : {}),
  };
}

/** The status the server sent; models it does not describe correctly are left out. Throws on anything else. */
export function parseVoiceStatus(data: unknown): VoiceStatusResponse {
  if (!isRecord(data) || !Array.isArray(data.models)) throw new Error('invalid voice status');
  const models = data.models.map(parseModel).filter((model): model is VoiceModelStatus => model !== undefined);
  return { enabled: data.enabled !== false, models };
}
