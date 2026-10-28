// The voice input: a state machine over the model on this computer (downloaded by the AI Office server), a Whisper
// worker in this browser and the microphone. Nothing is ever sent anywhere but the local server's model files.
import { voiceModelId, type Locale, type VoiceModelSize } from '@ai-office/shared';
import { peakOf } from './audio';
import { MAX_RECORDING_MS, MIN_RECORDING_MS, MODEL_BASE_URL, MODEL_IDLE_MS, SILENCE_PEAK } from './constants';
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
  /** The model size the person picked. */
  preference: VoicePreference;
  /** The language of the interface: what is spoken unless `setLanguage` says otherwise. */
  locale: () => Locale;
  /** Whether this browser can do it at all (microphone, workers, WebAssembly). */
  supported: () => boolean;
}

interface PendingJob {
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

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
  let workerSize: VoiceModelSize | undefined;
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
    workerSize = undefined;
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
      jobs.get(message.id)?.resolve(message.text);
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

  /** Loads the model into a worker (once; a loaded one is reused). `onProgress` hears 0..1 while it loads. */
  function ensureLoaded(onProgress?: (progress: number) => void): Promise<void> {
    const size = deps.preference.size();
    if (worker !== undefined && workerSize !== size) dropWorker();
    if (loaded) return Promise.resolve();
    if (onProgress !== undefined) loadProgress = onProgress;
    if (loading !== undefined) return loading;
    const created = deps.createWorker();
    worker = created;
    workerSize = size;
    created.onMessage(onWorkerMessage);
    created.onFailure(() => {
      if (worker === created) dropWorker();
    });
    loading = new Promise<void>((resolve, reject) => {
      settleLoad = { resolve, reject };
    });
    // The failure is reported to whoever awaits `loading`; a load nobody awaits (started with the take) stays quiet.
    loading.catch(() => undefined);
    created.post({ type: 'load', model: voiceModelId(size), baseUrl: MODEL_BASE_URL });
    return loading;
  }

  function transcribe(audio: Float32Array): Promise<string> {
    const current = worker;
    if (current === undefined || !loaded) return Promise.reject(new Error('model not loaded'));
    const id = nextJob++;
    const result = new Promise<string>((resolve, reject) => jobs.set(id, { resolve, reject }));
    current.post({ type: 'transcribe', id, audio, language: whisperLanguage(language ?? deps.locale()) }, [
      audio.buffer,
    ]);
    return result;
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
    const model = deps.models.statusOf(deps.preference.size());
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
  // The models are shared: the status may already be known (Settings read it); either way ask the server again.
  syncFromModels();
  void deps.models.refresh();

  async function runPrepare(): Promise<void> {
    stickyError = false;
    if (deps.models.current() === null) await deps.models.refresh();
    const current = deps.models.current();
    if (current === null) return setError(VOICE_ERROR_KEYS.downloadNetwork);
    if (!current.enabled) return set({ state: 'unavailable', errorKey: VOICE_ERROR_KEYS.disabled });
    const size = deps.preference.size();
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
    if (recording.durationMs < MIN_RECORDING_MS || peakOf(recording.samples) < SILENCE_PEAK) {
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
      const text = await transcribe(recording.samples);
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
      dropWorker();
      disposed = true;
      listeners.clear();
    },
  };
}
