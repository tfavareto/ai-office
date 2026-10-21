// The playback clock of a replay: where in the day it is, how fast it runs and whether it runs. Pure transitions over
// an immutable state, so seeking, speeds and the end of the day are easy to test.

/** Replay seconds per real second. */
export const SPEEDS = [30, 120, 600, 1800] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 600;
/** A frame that took longer than this (a hidden tab, a long pause in the debugger) counts as this much. */
export const MAX_FRAME_MS = 250;
/** Replay milliseconds the arrow keys skip, and with Shift. */
export const SKIP_MS = 60_000;
export const BIG_SKIP_MS = 10 * 60_000;

export interface ClockState {
  /** The span worth watching (epoch ms). */
  from: number;
  to: number;
  /** The instant being shown. */
  t: number;
  speed: Speed;
  playing: boolean;
}

export function isSpeed(value: number): value is Speed {
  return (SPEEDS as readonly number[]).includes(value);
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/** A clock at the start of the span, playing. */
export function startClock(from: number, to: number, speed: Speed = DEFAULT_SPEED): ClockState {
  return { from, to: Math.max(from, to), t: from, speed, playing: true };
}

export function atEnd(clock: ClockState): boolean {
  return clock.t >= clock.to;
}

/** Moves on by `realMs` of wall-clock time; stops at the end of the span. */
export function advance(clock: ClockState, realMs: number): ClockState {
  if (!clock.playing || realMs <= 0) return clock;
  const t = Math.min(clock.to, clock.t + Math.min(realMs, MAX_FRAME_MS) * clock.speed);
  return { ...clock, t, playing: t < clock.to };
}

/** Jumps to `t` (clamped to the span). Reaching the end stops the clock; anything else keeps it as it was. */
export function seek(clock: ClockState, t: number): ClockState {
  const next = clamp(t, clock.from, clock.to);
  return { ...clock, t: next, playing: next < clock.to && clock.playing };
}

export function skip(clock: ClockState, deltaMs: number): ClockState {
  return seek(clock, clock.t + deltaMs);
}

export function setSpeed(clock: ClockState, speed: Speed): ClockState {
  return { ...clock, speed };
}

export function pause(clock: ClockState): ClockState {
  return clock.playing ? { ...clock, playing: false } : clock;
}

/** Pauses a playing clock; resumes a paused one, from the start when it had reached the end. */
export function togglePlay(clock: ClockState): ClockState {
  if (clock.playing) return pause(clock);
  return atEnd(clock) ? { ...clock, t: clock.from, playing: true } : { ...clock, playing: true };
}

/** How far into the span the clock is, 0 to 1. */
export function progress(clock: ClockState): number {
  const length = clock.to - clock.from;
  return length <= 0 ? 1 : (clock.t - clock.from) / length;
}

/** The instant a fraction of the span (0 to 1) points at. */
export function timeAt(clock: Pick<ClockState, 'from' | 'to'>, fraction: number): number {
  return clock.from + clamp(fraction, 0, 1) * (clock.to - clock.from);
}
