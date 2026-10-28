// Records one take from the microphone: mono, up to a time limit, with a level for the meter. The take ends as 16 kHz
// Float32 audio, what Whisper wants. The microphone is released as soon as the take stops, is cancelled or hits the limit.
import { concatBlocks, levelOf, resample } from './audio';
import { MAX_RECORDING_MS, WHISPER_SAMPLE_RATE } from './constants';

export type RecorderErrorCode = 'denied' | 'no-device' | 'busy' | 'failed';

export class RecorderError extends Error {
  constructor(readonly code: RecorderErrorCode) {
    super(code);
    this.name = 'RecorderError';
  }
}

/** The browser's audio graph for one stream, behind an interface so tests can fake it. */
export interface CaptureSession {
  /** Sample rate of the blocks (the audio context's, usually 48 kHz). */
  sampleRate: number;
  onBlock(listener: (block: Float32Array) => void): void;
  close(): Promise<void>;
}

export interface RecorderEnv {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  openCapture(stream: MediaStream): Promise<CaptureSession>;
}

export interface Recording {
  /** Mono, 16 kHz. */
  samples: Float32Array;
  durationMs: number;
}

export interface RecorderProgress {
  /** 0..1, for a level meter. */
  level: number;
  elapsedMs: number;
  /** The take reached its limit: the microphone is already released and nothing more is recorded. */
  limitReached: boolean;
}

export interface Recorder {
  /** Asks for the microphone (the browser asks the person the first time) and starts recording. */
  start(): Promise<void>;
  /** Ends the take and releases the microphone. */
  stop(): Promise<Recording>;
  /** Drops the take and releases the microphone. */
  cancel(): void;
  onProgress(listener: (progress: RecorderProgress) => void): () => void;
  isRecording(): boolean;
}

interface Take {
  stream: MediaStream;
  capture: CaptureSession;
  blocks: Float32Array[];
  frames: number;
  released: boolean;
  limitReached: boolean;
}

/**
 * What the microphone is asked for, chosen for Whisper: one channel; echo cancellation on, so the office's own sounds
 * coming out of the speakers do not end up in the take; noise suppression off, because Whisper was trained on ordinary
 * noisy audio and copes with it, while the suppressor (tuned for calls) can clip soft word endings; automatic gain off,
 * because it moves the level mid-sentence, and the take is normalized as a whole before inference.
 */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: false,
};

const DENIED = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError']);
const NO_DEVICE = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']);
const BUSY = new Set(['NotReadableError', 'TrackStartError', 'AbortError']);

export function recorderErrorFor(error: unknown): RecorderError {
  if (error instanceof RecorderError) return error;
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (DENIED.has(name)) return new RecorderError('denied');
  if (NO_DEVICE.has(name)) return new RecorderError('no-device');
  if (BUSY.has(name)) return new RecorderError('busy');
  return new RecorderError('failed');
}

export function createRecorder(env: RecorderEnv, maxMs = MAX_RECORDING_MS): Recorder {
  const listeners = new Set<(progress: RecorderProgress) => void>();
  let take: Take | undefined;
  /** Bumped by every start and cancel, so a start that was cancelled while the browser asked for permission backs out. */
  let generation = 0;

  const emit = (progress: RecorderProgress): void => {
    for (const listener of [...listeners]) listener(progress);
  };

  function release(current: Take): void {
    if (current.released) return;
    current.released = true;
    for (const track of current.stream.getTracks()) track.stop();
    void current.capture.close().catch(() => undefined);
  }

  function addBlock(current: Take, block: Float32Array): void {
    if (current.released) return;
    const limitFrames = Math.floor((maxMs / 1000) * current.capture.sampleRate);
    const room = limitFrames - current.frames;
    const kept = block.length > room ? block.subarray(0, Math.max(0, room)) : block;
    current.blocks.push(kept.slice());
    current.frames += kept.length;
    current.limitReached = current.frames >= limitFrames;
    if (current.limitReached) release(current);
    emit({
      level: current.limitReached ? 0 : levelOf(kept),
      elapsedMs: Math.round((current.frames / current.capture.sampleRate) * 1000),
      limitReached: current.limitReached,
    });
  }

  async function start(): Promise<void> {
    if (take !== undefined) throw new RecorderError('failed');
    const mine = ++generation;
    let stream: MediaStream;
    try {
      stream = await env.getUserMedia({ audio: MIC_CONSTRAINTS });
    } catch (error) {
      throw recorderErrorFor(error);
    }
    const abandon = (): void => {
      for (const track of stream.getTracks()) track.stop();
    };
    if (mine !== generation) return abandon();
    let capture: CaptureSession;
    try {
      capture = await env.openCapture(stream);
    } catch (error) {
      abandon();
      throw recorderErrorFor(error);
    }
    if (mine !== generation) {
      abandon();
      return void capture.close().catch(() => undefined);
    }
    const current: Take = { stream, capture, blocks: [], frames: 0, released: false, limitReached: false };
    take = current;
    capture.onBlock((block) => addBlock(current, block));
  }

  return {
    start,
    async stop() {
      const current = take;
      if (current === undefined) throw new RecorderError('failed');
      take = undefined;
      release(current);
      const samples = resample(concatBlocks(current.blocks), current.capture.sampleRate, WHISPER_SAMPLE_RATE);
      return { samples, durationMs: Math.round((samples.length / WHISPER_SAMPLE_RATE) * 1000) };
    },
    cancel() {
      generation++;
      if (take !== undefined) release(take);
      take = undefined;
    },
    onProgress(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isRecording: () => take !== undefined,
  };
}
