// The voice input: a state machine over the model on this computer (downloaded by the AI Office server), a Whisper
// worker in this browser and the microphone. Nothing is ever sent anywhere but the local server's model files.
import { voiceModelId, type Locale } from '@ai-office/shared';
import { peakOf, prepareSpeech } from './audio';
import {
  MAX_RECORDING_MS,
  MIN_RECORDING_MS,
  MODEL_BASE_URL,
  MODEL_IDLE_MS,
  SILENCE_PEAK,
  WHISPER_SAMPLE_RATE,
} from './constants';
import { activeVoiceModel, type ActiveVoiceModel, type VoiceEngine } from './engine';
import { downloadErrorKey, recorderErrorKey, VOICE_ERROR_KEYS, type VoiceErrorKey } from './errors';
import { whisperLanguage } from './language';
import { VoiceDownloadError, type VoiceModels } from './models';
import type { VoicePreference } from './preference';
import { recorderErrorFor, type Recorder, type RecorderProgress } from './recorder';
import type { VoiceInput, VoiceState, VoiceStatus } from './types';
import type { WhisperWorker, WorkerResponse } from './worker/protocol';

export interface VoiceInputDeps {
  models: VoiceModels;
  recorder: Recorder;
  /** A fresh Whisper worker. Called again after the previous one was dropped (idle, cancelled, crashed). */
  createWorker: () => WhisperWorker;
  /** The model size and the language choice of the person. */
  preference: VoicePreference;
  /** Where the model can run in this browser (WebGPU, threads), and the timing of the last take. */
  engine: VoiceEngine;
  /** The language of the interface: what is spoken unless `setLanguage` says otherwise. */
  locale: () => Locale;
  /** Whether this browser can do it at all (microphone, workers, WebAssembly). */
  supported: () => boolean;
}

interface PendingJob {
  resolve: (result: { text: string; ms: number }) => void;
  reject: (error: Error) => void;
}

const sameModel = (a: ActiveVoiceModel | undefined, b: ActiveVoiceModel): boolean =>
  a !== undefined && a.size === b.size && a.device === b.device && a.threads === b.threads;

const BUSY_STATES: readonly VoiceState[] = ['loading', 'listening', 'transcribing'];

function sameStatus(a: VoiceStatus, b: VoiceStatus): boolean {
  return (
    a.state === b.state &&
    a.progress === b.progress &&
    a.errorKey === b.errorKey &&
    a.level === b.level &&
    a.elapsedMs === b.elapsedMs &&
    a.limitReached === b.limitReached
  );
}

export function createVoiceInputCore(deps: VoiceInputDeps): VoiceInput {
  const listeners = new Set<(status: VoiceStatus) => void>();
  let status: VoiceStatus = deps.supported()
    ? { state: 'off' }
    : { state: 'unavailable', errorKey: VOICE_ERROR_KEYS.unsupported };
  let language: Locale | 'auto' | undefined;
  let disposed = false;
  /** Set by failures of the microphone or the model: the error stays until the person acts again. */
  let stickyError = false;
  let preparing: Promise<void> | undefined;
  let starting = false;
  let inflight: Promise<string> | undefined;
  /** Bumped when a take is cancelled, so its late results are dropped. */
  let takeToken = 0;

  let worker: WhisperWorker | undefined;
  let workerModel: ActiveVoiceModel | undefined;
  let loaded = false;
  let loading: Promise<void> | undefined;
  let loadProgress: ((progress: number) => void) | undefined;
  let settleLoad: { resolve: () => void; reject: (error: Error) => void } | undefined;
  const jobs = new Map<number, PendingJob>();
  let nextJob = 1;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function set(next: VoiceStatus): void {
    if (disposed || sameStatus(status, next)) return;
    status = next;
    for (const listener of [...listeners]) listener(status);
  }

  const setError = (key: VoiceErrorKey): void => {
    stickyError = true;
    set({ state: 'error', errorKey: key });
  };

  // ---- the worker ----------------------------------------------------------------------------------------------

  function dropWorker(): void {
    clearTimeout(idleTimer);
    worker?.terminate();
    worker = undefined;
    workerModel = undefined;
    loaded = false;
    loading = undefined;
    loadProgress = undefined;
    const failed = new Error('worker dropped');
    settleLoad?.reject(failed);
    settleLoad = undefined;
    for (const job of jobs.values()) job.reject(failed);
    jobs.clear();
  }

  function onWorkerMessage(message: WorkerResponse): void {
    // A hundredth at a time: the files report every chunk, the page needs a percentage.
    if (message.type === 'progress') return loadProgress?.(Math.round(message.progress * 100) / 100);
    if (message.type === 'ready') {
      loaded = true;
      loadProgress = undefined;
      settleLoad?.resolve();
      settleLoad = undefined;
      return;
    }
    if (message.type === 'result') {
      jobs.get(message.id)?.resolve({ text: message.text, ms: message.ms });
      jobs.delete(message.id);
      return;
    }
    if (message.id === null) {
      const failed = new Error('load failed');
      settleLoad?.reject(failed);
      settleLoad = undefined;
      dropWorker();
      return;
    }
    jobs.get(message.id)?.reject(new Error('transcription failed'));
    jobs.delete(message.id);
  }

  /** The model to use: the person's pick, or what replaces it in this browser. Undefined until the engine is known. */
  function active(): ActiveVoiceModel | undefined {
    const capabilities = deps.engine.capabilities();
    return capabilities === undefined ? undefined : activeVoiceModel(deps.preference.size(), capabilities);
  }

  /** Loads the model into a worker (once; a loaded one is reused). `onProgress` hears 0..1 while it loads. */
  function ensureLoaded(onProgress?: (progress: number) => void): Promise<void> {
    const model = active();
    if (model === undefined) return Promise.reject(new Error('engine unknown'));
    if (worker !== undefined && !sameModel(workerModel, model)) dropWorker();
    if (loaded) return Promise.resolve();
    if (onProgress !== undefined) loadProgress = onProgress;
    if (loading !== undefined) return loading;
    const created = deps.createWorker();
    worker = created;
    workerModel = model;
    created.onMessage(onWorkerMessage);
    created.onFailure(() => {
      if (worker === created) dropWorker();
    });
    loading = new Promise<void>((resolve, reject) => {
      settleLoad = { resolve, reject };
    });
    // The failure is reported to whoever awaits `loading`; a load nobody awaits (started with the take) stays quiet.
    loading.catch(() => undefined);
    created.post({
      type: 'load',
      model: voiceModelId(model.size),
      baseUrl: MODEL_BASE_URL,
      device: model.device,
      threads: model.threads,
    });
    return loading;
  }

  /** What is spoken: the person's 'auto' choice in Settings wins, then `setLanguage`, then the interface language. */
  function spokenLanguage(): Locale | 'auto' {
    return deps.preference.language() === 'auto' ? 'auto' : (language ?? deps.locale());
  }

  async function transcribe(audio: Float32Array): Promise<string> {
    const current = worker;
    const model = workerModel;
    if (current === undefined || model === undefined || !loaded) throw new Error('model not loaded');
    const id = nextJob++;
    const result = new Promise<{ text: string; ms: number }>((resolve, reject) => jobs.set(id, { resolve, reject }));
    const audioMs = Math.round((audio.length / WHISPER_SAMPLE_RATE) * 1000);
    current.post({ type: 'transcribe', id, audio, language: whisperLanguage(spokenLanguage()) }, [audio.buffer]);
    const { text, ms } = await result;
    deps.engine.recordTake({ size: model.size, backend: model.backend, audioMs, ms });
    return text;
  }

  function scheduleIdleDrop(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (status.state === 'ready') dropWorker();
    }, MODEL_IDLE_MS);
  }

  // ---- state ---------------------------------------------------------------------------------------------------

  /** Takes the state from what the server says about the model, unless something else is going on. */
  function syncFromModels(): void {
    if (disposed || status.state === 'unavailable' || BUSY_STATES.includes(status.state)) return;
    if (status.state === 'error' && stickyError) return;
    const current = deps.models.current();
    if (current === null) return;
    if (!current.enabled) return set({ state: 'unavailable', errorKey: VOICE_ERROR_KEYS.disabled });
    const target = active();
    if (target === undefined) return;
    const model = deps.models.statusOf(target.size);
    if (model?.state === 'downloading')
      return set({ state: 'downloading', progress: model.bytes === 0 ? 0 : model.downloadedBytes / model.bytes });
    // While prepare() runs it decides what comes after the download.
    if (preparing !== undefined) return;
    if (model?.state === 'ready') return set({ state: 'ready' });
    // No model on disk any more (removed in Settings): free the one held in memory too.
    dropWorker();
    set({ state: 'off' });
  }

  const unsubscribeModels = deps.models.onChange(syncFromModels);
  const unsubscribePreference = deps.preference.onChange(syncFromModels);
  const unsubscribeEngine = deps.engine.onChange(syncFromModels);
  // The models are shared: the status may already be known (Settings read it); either way ask the server again.
  syncFromModels();
  void deps.models.refresh();
  if (status.state !== 'unavailable') void deps.engine.ready();

  async function runPrepare(): Promise<void> {
    stickyError = false;
    const capabilities = await deps.engine.ready();
    if (deps.models.current() === null) await deps.models.refresh();
    const current = deps.models.current();
    if (current === null) return setError(VOICE_ERROR_KEYS.downloadNetwork);
    if (!current.enabled) return set({ state: 'unavailable', errorKey: VOICE_ERROR_KEYS.disabled });
    const { size } = activeVoiceModel(deps.preference.size(), capabilities);
    if (deps.models.statusOf(size)?.state !== 'ready') {
      set({ state: 'downloading', progress: 0 });
      try {
        await deps.models.download(size);
      } catch (error) {
        const key =
          error instanceof VoiceDownloadError ? downloadErrorKey(error.code) : VOICE_ERROR_KEYS.downloadNetwork;
        if (key === undefined) return set({ state: 'off' });
        return setError(key);
      }
    }
    set({ state: 'loading', progress: 0 });
    try {
      await ensureLoaded((progress) => set({ state: 'loading', progress }));
    } catch {
      return setError(VOICE_ERROR_KEYS.load);
    }
    set({ state: 'ready' });
    scheduleIdleDrop();
  }

  const onRecorderProgress = (progress: RecorderProgress): void => {
    if (status.state !== 'listening') return;
    set({
      state: 'listening',
      level: progress.level,
      elapsedMs: progress.elapsedMs,
      limitMs: MAX_RECORDING_MS,
      ...(progress.limitReached ? { limitReached: true } : {}),
    });
  };
  const unsubscribeRecorder = deps.recorder.onProgress(onRecorderProgress);

  async function runStart(): Promise<void> {
    if (status.state === 'error') {
      stickyError = false;
      syncFromModels();
    }
    if (status.state !== 'ready' || starting) return;
    starting = true;
    clearTimeout(idleTimer);
    // The model loads while the person talks, so it is ready when they stop.
    void ensureLoaded().catch(() => undefined);
    try {
      await deps.recorder.start();
    } catch (error) {
      starting = false;
      return setError(recorderErrorKey(recorderErrorFor(error).code));
    }
    starting = false;
    if (disposed || !deps.recorder.isRecording()) return;
    set({ state: 'listening', level: 0, elapsedMs: 0, limitMs: MAX_RECORDING_MS });
  }

  async function runStop(): Promise<string> {
    const token = takeToken;
    let recording;
    try {
      recording = await deps.recorder.stop();
    } catch (error) {
      setError(recorderErrorKey(recorderErrorFor(error).code));
      return '';
    }
    if (token !== takeToken) return '';
    const speech =
      recording.durationMs < MIN_RECORDING_MS || peakOf(recording.samples) < SILENCE_PEAK
        ? null
        : prepareSpeech(recording.samples, WHISPER_SAMPLE_RATE);
    if (speech === null) {
      set({ state: 'ready' });
      scheduleIdleDrop();
      return '';
    }
    try {
      if (!loaded) {
        set({ state: 'loading', progress: 0 });
        await ensureLoaded((progress) => token === takeToken && set({ state: 'loading', progress }));
      }
    } catch {
      if (token === takeToken) setError(VOICE_ERROR_KEYS.load);
      return '';
    }
    if (token !== takeToken) return '';
    set({ state: 'transcribing' });
    try {
      const text = await transcribe(speech);
      if (token !== takeToken) return '';
      set({ state: 'ready' });
      scheduleIdleDrop();
      return text.trim();
    } catch {
      if (token === takeToken) setError(VOICE_ERROR_KEYS.transcribe);
      return '';
    }
  }

  return {
    status: () => status,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prepare() {
      if (disposed || status.state === 'unavailable') return Promise.resolve();
      preparing ??= runPrepare().finally(() => {
        preparing = undefined;
        syncFromModels();
      });
      return preparing;
    },
    start: () => (disposed ? Promise.resolve() : runStart()),
    stop() {
      if (inflight !== undefined) return inflight;
      if (disposed || status.state !== 'listening') return Promise.resolve('');
      inflight = runStop().finally(() => {
        inflight = undefined;
      });
      return inflight;
    },
    cancel() {
      if (disposed) return;
      takeToken++;
      starting = false;
      deps.recorder.cancel();
      if (
        status.state === 'listening' ||
        status.state === 'transcribing' ||
        (status.state === 'loading' && preparing === undefined)
      ) {
        // The model may be in the middle of a transcription: dropping its worker is how that is stopped.
        if (status.state !== 'listening') dropWorker();
        stickyError = false;
        set({ state: 'ready' });
      }
    },
    setLanguage(next) {
      language = next;
    },
    dispose() {
      if (disposed) return;
      takeToken++;
      deps.recorder.cancel();
      unsubscribeRecorder();
      unsubscribeModels();
      unsubscribePreference();
      unsubscribeEngine();
      dropWorker();
      disposed = true;
      listeners.clear();
    },
  };
}
