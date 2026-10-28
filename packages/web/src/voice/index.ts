// Local voice input. `createVoiceInput()` gives the command bar a `VoiceInput`; `sharedVoiceModels()` is the state of the
// speech models, shared with the settings row so a download started there shows up everywhere.
import type { Locale } from '@ai-office/shared';
import { createVoiceApi } from './api';
import { createBrowserWhisperWorker, isVoiceSupported } from './browser';
import { locale as currentLocale } from '../i18n';
import { createVoiceModels, type VoiceModels } from './models';
import { createVoicePreference, type VoicePreference } from './preference';
import { createRecorder, type Recorder } from './recorder';
import type { VoiceInput } from './types';
import { createVoiceInputCore } from './voice-input';
import { browserRecorderEnv } from './web-audio-capture';
import type { WhisperWorker } from './worker/protocol';

export { isVoiceSupported } from './browser';
export { createMicButton, type MicButton, type MicButtonOptions } from './mic-button';
export type { VoiceInput, VoiceState, VoiceStatus } from './types';
export type { VoiceModels } from './models';
export type { VoicePreference } from './preference';

let models: VoiceModels | undefined;
let preference: VoicePreference | undefined;

/** The one state of the speech models for this page. */
export function sharedVoiceModels(): VoiceModels {
  models ??= createVoiceModels(createVoiceApi());
  return models;
}

/** The one size preference for this page. */
export function sharedVoicePreference(): VoicePreference {
  preference ??= createVoicePreference();
  return preference;
}

/** Everything `createVoiceInput` takes from the browser, replaceable (tests, a different server). */
export interface VoiceInputOptions {
  models?: VoiceModels;
  preference?: VoicePreference;
  recorder?: Recorder;
  createWorker?: () => WhisperWorker;
  /** The language of the interface (default: the page's). */
  locale?: () => Locale;
  supported?: () => boolean;
}

export function createVoiceInput(options: VoiceInputOptions = {}): VoiceInput {
  return createVoiceInputCore({
    models: options.models ?? sharedVoiceModels(),
    preference: options.preference ?? sharedVoicePreference(),
    recorder: options.recorder ?? createRecorder(browserRecorderEnv()),
    createWorker: options.createWorker ?? createBrowserWhisperWorker,
    locale: options.locale ?? currentLocale,
    supported: options.supported ?? isVoiceSupported,
  });
}

/** What the app shares: the voice input, the state of the models and the size preference. */
export interface VoiceHandle {
  input: VoiceInput;
  models: VoiceModels;
  preference: VoicePreference;
}

/** The pieces the app (command bar, settings) uses; they all read the same models and preference. */
export function createVoice(options: Pick<VoiceInputOptions, 'supported' | 'locale'> = {}): VoiceHandle {
  const models = sharedVoiceModels();
  const preference = sharedVoicePreference();
  return { input: createVoiceInput({ ...options, models, preference }), models, preference };
}
