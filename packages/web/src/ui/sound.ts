// Tiny WebAudio cues (no audio files). The context is created lazily, after a user gesture, as browsers require.
export type CueKind = 'alert' | 'info' | 'success' | 'sent';

interface Tone {
  freq: number;
  start: number;
  duration: number;
  gain: number;
  type: OscillatorType;
}

const CUES: Record<CueKind, readonly Tone[]> = {
  alert: [
    { freq: 880, start: 0, duration: 0.14, gain: 0.9, type: 'sine' },
    { freq: 1175, start: 0.16, duration: 0.2, gain: 0.9, type: 'sine' },
  ],
  info: [{ freq: 660, start: 0, duration: 0.16, gain: 0.6, type: 'sine' }],
  success: [
    { freq: 523, start: 0, duration: 0.1, gain: 0.6, type: 'triangle' },
    { freq: 784, start: 0.1, duration: 0.18, gain: 0.6, type: 'triangle' },
  ],
  sent: [{ freq: 440, start: 0, duration: 0.09, gain: 0.45, type: 'triangle' }],
};

type AudioContextCtor = typeof AudioContext;

function audioContextConstructor(): AudioContextCtor | null {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class SoundPlayer {
  private context: AudioContext | null = null;

  /** Call from a user gesture so later cues are allowed to play. */
  unlock(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = audioContextConstructor();
    if (!Ctor) return null;
    try {
      this.context = new Ctor();
    } catch {
      this.context = null;
    }
    return this.context;
  }

  play(kind: CueKind, volume: number): void {
    const ctx = this.ensure();
    if (!ctx || volume <= 0 || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (const tone of CUES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const peak = Math.max(0.0001, tone.gain * volume * 0.25);
      osc.type = tone.type;
      osc.frequency.value = tone.freq;
      gain.gain.setValueAtTime(0.0001, now + tone.start);
      gain.gain.exponentialRampToValueAtTime(peak, now + tone.start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.start + tone.duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + tone.start);
      osc.stop(now + tone.start + tone.duration + 0.03);
    }
  }
}
