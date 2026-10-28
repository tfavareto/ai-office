// Contract between the Pro view's command bar and the local voice input (speech-to-text that runs in this browser,
// with a Whisper model served by the local AI Office server). The command bar only depends on this file.
import type { Locale } from '@ai-office/shared';

/** off: no model yet · downloading: the server is fetching the model · loading: the browser is loading it ·
 *  ready: idle, can record · listening: recording · transcribing: turning the recording into text · error. */
export type VoiceState =
  'unavailable' | 'off' | 'downloading' | 'loading' | 'ready' | 'listening' | 'transcribing' | 'error';

export interface VoiceStatus {
  state: VoiceState;
  /** 0..1 while downloading or loading. */
  progress?: number;
  /** Localizable reason when state is 'error' or 'unavailable' (catalog key + params). */
  errorKey?: string;
  /** While listening: how loud the microphone is right now, 0..1 (for a level meter). */
  level?: number;
  /** While listening: how long the take is, in milliseconds. */
  elapsedMs?: number;
  /** While listening: the longest a take can be. */
  limitMs?: number;
  /** While listening: the take hit the limit. The microphone is already released; `stop()` transcribes what was heard. */
  limitReached?: boolean;
}

/**
 * None of the methods rejects: a failure shows up as `state: 'error'` (or 'unavailable') with an `errorKey`, and
 * `stop()` then resolves with an empty string.
 */
export interface VoiceInput {
  status(): VoiceStatus;
  onStatus(listener: (status: VoiceStatus) => void): () => void;
  /** Asks the local server to download the model once (explicit user action), then loads it in the browser. */
  prepare(): Promise<void>;
  /** Starts recording from the microphone (asks the browser for permission the first time). */
  start(): Promise<void>;
  /** Stops recording and resolves with the transcribed text (never sent anywhere; the user reviews it first). */
  stop(): Promise<string>;
  cancel(): void;
  setLanguage(locale: Locale | 'auto'): void;
  dispose(): void;
}
