// The voice routes of the AI Office server: what the page may ask about the speech models.
import { API, type VoiceModelSize, type VoiceStatusResponse } from '@ai-office/shared';
import { isRecord } from '../net/parse';
import { parseVoiceStatus } from './parse';

const REQUEST_TIMEOUT_MS = 15_000;

/** The server refused or could not be reached: `kind` says which, for the message. */
export class VoiceApiError extends Error {
  constructor(readonly kind: 'busy' | 'disabled' | 'unreachable' | 'failed') {
    super(kind);
    this.name = 'VoiceApiError';
  }
}

export interface VoiceApi {
  status(): Promise<VoiceStatusResponse>;
  /** Starts the one-time download of a model (or joins the one running). */
  startDownload(size: VoiceModelSize): Promise<VoiceStatusResponse>;
  remove(size: VoiceModelSize): Promise<VoiceStatusResponse>;
}

type FetchLike = typeof fetch;

export function createVoiceApi(fetchImpl: FetchLike = (...args) => fetch(...args)): VoiceApi {
  async function call(path: string, init: RequestInit): Promise<VoiceStatusResponse> {
    let response: Response;
    try {
      response = await fetchImpl(path, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new VoiceApiError('unreachable');
    }
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 409) {
      throw new VoiceApiError(isRecord(body) && body.error === 'voice-disabled' ? 'disabled' : 'busy');
    }
    if (!response.ok) throw new VoiceApiError('failed');
    try {
      return parseVoiceStatus(body);
    } catch {
      throw new VoiceApiError('failed');
    }
  }

  const json = { Accept: 'application/json', 'Content-Type': 'application/json' };
  return {
    status: () => call(`${API.voice}/status`, { method: 'GET', headers: { Accept: 'application/json' } }),
    startDownload: (size) =>
      call(`${API.voice}/download`, { method: 'POST', headers: json, body: JSON.stringify({ size }) }),
    remove: (size) =>
      call(`${API.voice}/model/whisper-${size}`, { method: 'DELETE', headers: { Accept: 'application/json' } }),
  };
}
