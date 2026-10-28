// What the microphone button of a Pro prompt says and allows, from the state of the local voice input. Pure. Two
// prompts can be on screen (the command bar and the room panel) and share one microphone: only the one that started
// a dictation can stop it; the other waits.
import type { TextKey } from '../../i18n';
import type { VoiceStatus } from '../../voice/types';

export interface MicView {
  label: TextKey;
  hint: TextKey;
  percent: number;
  /** The engine's own reason (catalog key) for an error or for being unavailable. */
  errorKey?: string;
  disabled: boolean;
  listening: boolean;
  busy: boolean;
}

const BUSY_STATES: ReadonlySet<VoiceStatus['state']> = new Set(['downloading', 'loading', 'transcribing']);

export function micView(hasVoice: boolean, status: VoiceStatus, ownsRecording: boolean): MicView {
  const percent = Math.round((status.progress ?? 0) * 100);
  const base = { percent, disabled: false, listening: false, busy: BUSY_STATES.has(status.state) };
  if (!hasVoice || status.state === 'unavailable')
    return {
      ...base,
      label: 'pro.voice.label',
      hint: 'pro.voice.unavailable',
      ...(status.errorKey !== undefined ? { errorKey: status.errorKey } : {}),
      disabled: true,
    };
  const recording = status.state === 'listening' || status.state === 'transcribing';
  if (recording && !ownsRecording)
    return { ...base, label: 'pro.voice.label', hint: 'pro.voice.elsewhere', disabled: true };
  switch (status.state) {
    case 'off':
      return { ...base, label: 'pro.voice.prepare', hint: 'pro.voice.prepare.hint' };
    case 'downloading':
      return { ...base, label: 'pro.voice.downloading', hint: 'pro.voice.downloading.hint', disabled: true };
    case 'loading':
      return { ...base, label: 'pro.voice.loading', hint: 'pro.voice.loading.hint', disabled: true };
    case 'listening':
      return { ...base, label: 'pro.voice.stop', hint: 'pro.voice.stop.hint', listening: true };
    case 'transcribing':
      return { ...base, label: 'pro.voice.transcribing', hint: 'pro.voice.transcribing', disabled: true };
    case 'error':
      return {
        ...base,
        label: 'pro.voice.retry',
        hint: 'pro.voice.error',
        ...(status.errorKey !== undefined ? { errorKey: status.errorKey } : {}),
      };
    default:
      return { ...base, label: 'pro.voice.start', hint: 'pro.voice.start.hint' };
  }
}
