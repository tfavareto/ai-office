// What the mic button shows for a voice status: pure, so every state is testable without a DOM.
import { VOICE_MODEL_SIZES, type VoiceModelSize } from '@ai-office/shared';
import { t, type TextKey } from '../i18n';
import { formatDecimal, formatElapsed } from '../ui/format';
import type { IconName } from '../ui/icons';
import { VOICE_ERROR_KEYS } from './errors';
import type { VoiceStatus } from './types';

export type MicKind = 'unavailable' | 'download' | 'progress' | 'record' | 'listening' | 'working' | 'error';

export interface MicView {
  kind: MicKind;
  /** Name of the main button (also its tooltip). */
  actionLabel: string;
  icon: IconName;
  /** Text next to the button; announced politely. */
  text: string;
  /** 0..1 for a progress bar, when there is one. */
  progress?: number;
  /** 0..1 for the level meter, when listening. */
  meter?: number;
  disabled: boolean;
  /** The take can be cancelled (listening, or transcribing). */
  cancellable: boolean;
  /** What the main button does in an error: download again, or record again. */
  retry?: 'prepare' | 'start';
}

const ERROR_KEYS: ReadonlySet<string> = new Set(Object.values(VOICE_ERROR_KEYS));
const MB = 1_000_000;
const GB = 1_000_000_000;
const PERCENT = 100;

/** Size of a download as "80 MB", or "1.6 GB" (in the interface's number format) from a gigabyte up. */
export function formatMegabytes(bytes: number): string {
  if (bytes >= GB) return `${formatDecimal(bytes / GB, 1)} GB`;
  return `${Math.max(1, Math.round(bytes / MB))} MB`;
}

/** The sentence for an error key of the voice input; anything unknown reads as a microphone problem. */
export function voiceErrorText(key: string | undefined): string {
  return t((key !== undefined && ERROR_KEYS.has(key) ? key : VOICE_ERROR_KEYS.mic) as TextKey);
}

export function percentOf(progress: number | undefined): number {
  return Math.round(Math.min(1, Math.max(0, progress ?? 0)) * PERCENT);
}

/** "Rápido · 44 MB" for the size menu. */
export function sizeOptionLabel(size: VoiceModelSize, bytes: number | undefined): string {
  const name = t(`voice.size.${size}`);
  return bytes === undefined ? name : t('voice.size.option', { name, size: formatMegabytes(bytes) });
}

export function isVoiceSize(value: string): value is VoiceModelSize {
  return (VOICE_MODEL_SIZES as readonly string[]).includes(value);
}

/** Whether an error is about getting the model (so trying again means downloading or loading it, not recording). */
function isModelError(key: string | undefined): boolean {
  return key !== undefined && (key.startsWith('voice.error.download') || key === VOICE_ERROR_KEYS.load);
}

export function micView(status: VoiceStatus, downloadBytes?: number): MicView {
  const base = { disabled: false, cancellable: false, text: '' };
  switch (status.state) {
    case 'unavailable':
      return {
        ...base,
        kind: 'unavailable',
        icon: 'mic',
        actionLabel: t('voice.mic.start'),
        text: voiceErrorText(status.errorKey),
        disabled: true,
      };
    case 'off':
      return {
        ...base,
        kind: 'download',
        icon: 'arrowDown',
        actionLabel:
          downloadBytes === undefined
            ? t('voice.download')
            : t('voice.download.withSize', { size: formatMegabytes(downloadBytes) }),
        text: t('voice.download.privacy'),
      };
    case 'downloading':
      return {
        ...base,
        kind: 'progress',
        icon: 'arrowDown',
        actionLabel: t('voice.mic.downloading', { percent: percentOf(status.progress) }),
        text: t('voice.mic.downloading', { percent: percentOf(status.progress) }),
        progress: status.progress ?? 0,
        disabled: true,
      };
    case 'loading':
      return {
        ...base,
        kind: 'progress',
        icon: 'mic',
        actionLabel: t('voice.mic.loading', { percent: percentOf(status.progress) }),
        text: t('voice.mic.loading', { percent: percentOf(status.progress) }),
        progress: status.progress ?? 0,
        disabled: true,
      };
    case 'ready':
      return { ...base, kind: 'record', icon: 'mic', actionLabel: t('voice.mic.start') };
    case 'listening':
      return {
        ...base,
        kind: 'listening',
        icon: 'stop',
        actionLabel: t('voice.mic.stop'),
        text: status.limitReached
          ? t('voice.mic.limit', { seconds: Math.round((status.limitMs ?? 0) / 1000) })
          : t('voice.mic.listening', { time: formatElapsed(status.elapsedMs ?? 0) }),
        meter: status.level ?? 0,
        cancellable: true,
      };
    case 'transcribing':
      return {
        ...base,
        kind: 'working',
        icon: 'mic',
        actionLabel: t('voice.mic.transcribing'),
        text: t('voice.mic.transcribing'),
        disabled: true,
        cancellable: true,
      };
    case 'error':
      return {
        ...base,
        kind: 'error',
        icon: 'mic',
        actionLabel: t('common.retry'),
        text: voiceErrorText(status.errorKey),
        retry: isModelError(status.errorKey) ? 'prepare' : 'start',
      };
  }
}
