// Local voice input. `createVoiceInput()` gives the command bar a `VoiceInput`; `sharedVoiceModels()` is the state of the
// speech models, shared with the settings row so a download started there shows up everywhere.
import type { Locale } from '@ai-office/shared';
import { createVoiceApi } from './api';
import { createBrowserWhisperWorker, detectVoiceCapabilities, isVoiceSupported } from './browser';
import { createVoiceEngine, type VoiceEngine } from './engine';
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
export type { VoiceEngine } from './engine';
export type { VoicePreference } from './preference';

let models: VoiceModels | undefined;
let preference: VoicePreference | undefined;
let engine: VoiceEngine | undefined;

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

/** Where the model runs in this page (WebGPU, threads), found once. */
export function sharedVoiceEngine(): VoiceEngine {
  engine ??= createVoiceEngine(detectVoiceCapabilities);
  return engine;
}

/** Everything `createVoiceInput` takes from the browser, replaceable (tests, a different server). */
export interface VoiceInputOptions {
  models?: VoiceModels;
  preference?: VoicePreference;
  engine?: VoiceEngine;
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
    engine: options.engine ?? sharedVoiceEngine(),
    recorder: options.recorder ?? createRecorder(browserRecorderEnv()),
    createWorker: options.createWorker ?? createBrowserWhisperWorker,
    locale: options.locale ?? currentLocale,
    supported: options.supported ?? isVoiceSupported,
  });
}

/** What the app shares: the voice input, the state of the models, the preference and the engine. */
export interface VoiceHandle {
  input: VoiceInput;
  models: VoiceModels;
  preference: VoicePreference;
  engine: VoiceEngine;
}

/** The pieces the app (command bar, settings) uses; they all read the same models and preference. */
export function createVoice(options: Pick<VoiceInputOptions, 'supported' | 'locale'> = {}): VoiceHandle {
  const models = sharedVoiceModels();
  const preference = sharedVoicePreference();
  const engine = sharedVoiceEngine();
  return { input: createVoiceInput({ ...options, models, preference, engine }), models, preference, engine };
}
