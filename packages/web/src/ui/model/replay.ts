// Pure helpers behind the time-lapse controls: where a time sits on the scrubber, the labels of its axis, which mark
// comes next, and what from the live office still deserves a glance while the past is on screen.
import type { OfficeSnapshot } from '@ai-office/shared';
import type { Marker } from '../../timelapse/markers';

const MINUTE = 60_000;
const AXIS_STEPS_MIN = [15, 30, 60, 120, 180, 360] as const;
/** The axis shows at most this many labels. */
const MAX_AXIS_LABELS = 7;
/** How close (in pixels) a pointer has to be to a mark to describe it. */
export const MARKER_REACH_PX = 8;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Where `at` sits on the scrubber, 0 to 100 (an empty span puts everything at the end). */
export function percentOf(at: number, from: number, to: number): number {
  return to <= from ? 100 : clamp01((at - from) / (to - from)) * 100;
}

/** The fraction of the span a pointer at `clientX` points at, given the scrubber's left edge and width. */
export function fractionAt(clientX: number, left: number, width: number): number {
  return width <= 0 ? 0 : clamp01((clientX - left) / width);
}

/** The replay milliseconds that `pixels` stand for on a scrubber `width` pixels wide. */
export function pixelsToMs(pixels: number, width: number, from: number, to: number): number {
  return width <= 0 ? 0 : ((to - from) * pixels) / width;
}

function localMidnight(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Round clock times (local) inside the span, as many as read well, for the labels under the scrubber. */
export function axisTicks(from: number, to: number): number[] {
  if (to <= from) return [];
  const midnight = localMidnight(from);
  for (const step of AXIS_STEPS_MIN) {
    const stepMs = step * MINUTE;
    const first = midnight + Math.ceil((from - midnight) / stepMs) * stepMs;
    const ticks: number[] = [];
    for (let at = first; at < to; at += stepMs) ticks.push(at);
    if (ticks.length <= MAX_AXIS_LABELS) return ticks;
  }
  return [];
}

/** The next (`direction` 1) or previous (-1) mark after `at`, ignoring the ones on it; undefined at the ends. */
export function markerStep(markers: readonly Marker[], at: number, direction: 1 | -1): Marker | undefined {
  const margin = 1000;
  if (direction === 1) return markers.find((marker) => marker.at > at + margin);
  for (let i = markers.length - 1; i >= 0; i--) if ((markers[i] as Marker).at < at - margin) return markers[i];
  return undefined;
}

/** How many people of the live office are waiting for the user right now (the past never shows that). */
export function liveAttention(snapshot: OfficeSnapshot | null): number {
  return snapshot === null ? 0 : snapshot.agents.filter((agent) => agent.status === 'waiting').length;
}
