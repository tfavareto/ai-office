// The catalog keys of the reasons voice input can fail, and which failure gets which.
import type { VoiceDownloadErrorCode } from '@ai-office/shared';
import type { VoiceDownloadFailureCode } from './models';
import type { RecorderErrorCode } from './recorder';

export const VOICE_ERROR_KEYS = {
  unsupported: 'voice.error.unsupported',
  disabled: 'voice.error.disabled',
  denied: 'voice.error.denied',
  noDevice: 'voice.error.noDevice',
  busy: 'voice.error.busy',
  mic: 'voice.error.mic',
  downloadNetwork: 'voice.error.downloadNetwork',
  downloadIntegrity: 'voice.error.downloadIntegrity',
  downloadDisk: 'voice.error.downloadDisk',
  downloadBusy: 'voice.error.downloadBusy',
  load: 'voice.error.load',
  transcribe: 'voice.error.transcribe',
} as const;

export type VoiceErrorKey = (typeof VOICE_ERROR_KEYS)[keyof typeof VOICE_ERROR_KEYS];

export function recorderErrorKey(code: RecorderErrorCode): VoiceErrorKey {
  switch (code) {
    case 'denied':
      return VOICE_ERROR_KEYS.denied;
    case 'no-device':
      return VOICE_ERROR_KEYS.noDevice;
    case 'busy':
      return VOICE_ERROR_KEYS.busy;
    case 'failed':
      return VOICE_ERROR_KEYS.mic;
  }
}

/** The reason a download stopped, as a sentence the person can act on; undefined when nothing went wrong (cancelled). */
export function downloadErrorKey(code: VoiceDownloadFailureCode | VoiceDownloadErrorCode): VoiceErrorKey | undefined {
  switch (code) {
    case 'network':
    case 'timeout':
    case 'unreachable':
      return VOICE_ERROR_KEYS.downloadNetwork;
    case 'integrity':
    case 'size':
      return VOICE_ERROR_KEYS.downloadIntegrity;
    case 'disk':
      return VOICE_ERROR_KEYS.downloadDisk;
    case 'busy':
      return VOICE_ERROR_KEYS.downloadBusy;
    case 'disabled':
      return VOICE_ERROR_KEYS.disabled;
    case 'cancelled':
      return undefined;
  }
}
