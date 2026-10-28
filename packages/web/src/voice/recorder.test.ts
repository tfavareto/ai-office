import { describe, expect, it, vi } from 'vitest';
import {
  createRecorder,
  RecorderError,
  recorderErrorFor,
  type CaptureSession,
  type RecorderEnv,
  type RecorderProgress,
} from './recorder';

class FakeTrack {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack(), new FakeTrack()];
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

interface Rig {
  env: RecorderEnv;
  stream: FakeStream;
  constraints: MediaStreamConstraints[];
  push(block: Float32Array): void;
  closed: () => boolean;
}

function rig(options: { sampleRate?: number; denyWith?: string; captureFails?: boolean } = {}): Rig {
  const stream = new FakeStream();
  const constraints: MediaStreamConstraints[] = [];
  let listener: (block: Float32Array) => void = () => undefined;
  let closed = false;
  const capture: CaptureSession = {
    sampleRate: options.sampleRate ?? 48_000,
    onBlock: (next) => {
      listener = next;
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  };
  return {
    stream,
    constraints,
    push: (block) => listener(block),
    closed: () => closed,
    env: {
      getUserMedia: (wanted) => {
        constraints.push(wanted);
        if (options.denyWith !== undefined) return Promise.reject(new DOMException('no', options.denyWith));
        return Promise.resolve(stream as unknown as MediaStream);
      },
      openCapture: () =>
        options.captureFails === true ? Promise.reject(new Error('worklet')) : Promise.resolve(capture),
    },
  };
}

const seconds = (n: number, rate = 48_000, value = 0.5): Float32Array =>
  new Float32Array(Math.round(n * rate)).fill(value);

describe('recorder', () => {
  it('asks for a mono microphone and records the blocks it is given', async () => {
    const mic = rig();
    const recorder = createRecorder(mic.env);

    await recorder.start();
    mic.push(seconds(0.5));
    mic.push(seconds(0.5));
    const recording = await recorder.stop();

    expect(mic.constraints[0]).toEqual({ audio: { channelCount: 1 } });
    expect(recording.samples.length).toBe(16_000);
    expect(recording.durationMs).toBe(1000);
    expect(recording.samples[100]).toBeCloseTo(0.5, 6);
  });

  it('resamples whatever rate the audio context runs at to 16 kHz', async () => {
    const mic = rig({ sampleRate: 44_100 });
    const recorder = createRecorder(mic.env);

    await recorder.start();
    mic.push(seconds(2, 44_100));
    const recording = await recorder.stop();

    expect(recording.samples.length).toBe(32_000);
    expect(recording.durationMs).toBe(2000);
  });

  it('releases the microphone tracks and the audio graph when the take stops', async () => {
    const mic = rig();
    const recorder = createRecorder(mic.env);
    await recorder.start();

    await recorder.stop();

    expect(mic.stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(mic.closed()).toBe(true);
    expect(recorder.isRecording()).toBe(false);
  });

  it('releases the microphone and keeps nothing when cancelled', async () => {
    const mic = rig();
    const recorder = createRecorder(mic.env);
    await recorder.start();
    mic.push(seconds(1));

    recorder.cancel();

    expect(mic.stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(mic.closed()).toBe(true);
    await expect(recorder.stop()).rejects.toBeInstanceOf(RecorderError);
  });

  it('reports the level and the elapsed time with every block', async () => {
    const mic = rig();
    const recorder = createRecorder(mic.env);
    const seen: RecorderProgress[] = [];
    recorder.onProgress((progress) => seen.push(progress));
    await recorder.start();

    mic.push(seconds(0.5, 48_000, 0));
    mic.push(seconds(0.5, 48_000, 0.5));

    expect(seen.map((progress) => progress.elapsedMs)).toEqual([500, 1000]);
    expect(seen[0]?.level).toBe(0);
    expect(seen[1]?.level).toBeGreaterThan(0.5);
    expect(seen.every((progress) => !progress.limitReached)).toBe(true);
  });

  it('stops listening at the limit: the microphone is released and the rest is dropped', async () => {
    const mic = rig();
    const recorder = createRecorder(mic.env, 2000);
    const seen: RecorderProgress[] = [];
    recorder.onProgress((progress) => seen.push(progress));
    await recorder.start();

    mic.push(seconds(1.5));
    mic.push(seconds(1.5));
    mic.push(seconds(1));

    expect(mic.stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(seen.at(-1)).toEqual({ level: 0, elapsedMs: 2000, limitReached: true });
    expect(seen).toHaveLength(2);
    const recording = await recorder.stop();
    expect(recording.durationMs).toBe(2000);
    expect(recording.samples.length).toBe(32_000);
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-device'],
    ['OverconstrainedError', 'no-device'],
    ['NotReadableError', 'busy'],
    ['SomethingElse', 'failed'],
  ])('maps %s to %s', async (name, code) => {
    const recorder = createRecorder(rig({ denyWith: name }).env);

    await expect(recorder.start()).rejects.toMatchObject({ code });
    expect(recorder.isRecording()).toBe(false);
  });

  it('stops the tracks when the audio graph cannot be built', async () => {
    const mic = rig({ captureFails: true });
    const recorder = createRecorder(mic.env);

    await expect(recorder.start()).rejects.toMatchObject({ code: 'failed' });

    expect(mic.stream.tracks.every((track) => track.stopped)).toBe(true);
  });

  it('backs out when cancelled while the browser is still asking for permission', async () => {
    const mic = rig();
    let grant: (stream: MediaStream) => void = () => undefined;
    const env: RecorderEnv = {
      ...mic.env,
      getUserMedia: () => new Promise<MediaStream>((resolve) => (grant = resolve)),
    };
    const recorder = createRecorder(env);

    const starting = recorder.start();
    recorder.cancel();
    grant(mic.stream as unknown as MediaStream);
    await starting;

    expect(mic.stream.tracks.every((track) => track.stopped)).toBe(true);
    expect(recorder.isRecording()).toBe(false);
  });

  it('refuses a second take while one is recording', async () => {
    const recorder = createRecorder(rig().env);
    await recorder.start();

    await expect(recorder.start()).rejects.toBeInstanceOf(RecorderError);
  });

  it('stops notifying a listener that unsubscribed', async () => {
    const mic = rig();
    const recorder = createRecorder(mic.env);
    const listener = vi.fn();
    const off = recorder.onProgress(listener);
    await recorder.start();
    off();

    mic.push(seconds(0.1));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('recorderErrorFor', () => {
  it('keeps a recorder error and turns anything else into a failure', () => {
    const own = new RecorderError('busy');

    expect(recorderErrorFor(own)).toBe(own);
    expect(recorderErrorFor('boom').code).toBe('failed');
    expect(recorderErrorFor(new DOMException('x', 'NotAllowedError')).code).toBe('denied');
  });
});
