// The marks on the scrubber: the moments of the day worth jumping to. Pure.
import type { Timelapse } from '@ai-office/shared';

export type MarkerKind = 'commit' | 'test-failed' | 'wait' | 'arrival';

/** Marks of a higher priority win when two are too close to tell apart. */
const PRIORITY: Readonly<Record<MarkerKind, number>> = { 'test-failed': 0, wait: 1, commit: 2, arrival: 3 };

export interface Marker {
  at: number;
  kind: MarkerKind;
  /** The person (not set for a commit only Git saw). */
  agent?: string;
  /** The room. */
  project: string;
  /** A commit's subject, or the tool a wait was for. */
  detail?: string;
  /** How long the wait lasted. */
  durationMs?: number;
  /** Marks of the same kind merged into this one. */
  count: number;
}

function raw(timelapse: Timelapse): Marker[] {
  const projectOf = (agent: number): string => timelapse.projects.find((project) => project.id === timelapse.agents[agent]?.projectId)?.name ?? '';
  const markers: Marker[] = [];
  for (const event of timelapse.events) {
    switch (event.type) {
      case 'commit':
        markers.push({ at: event.at, kind: 'commit', ...(event.agent !== undefined ? { agent: timelapse.agents[event.agent]?.name ?? '' } : {}), project: timelapse.projects[event.project]?.name ?? '', detail: event.subject, count: 1 });
        break;
      case 'test':
        if (event.outcome === 'failed') markers.push({ at: event.at, kind: 'test-failed', agent: timelapse.agents[event.agent]?.name ?? '', project: projectOf(event.agent), detail: event.runner, count: 1 });
        break;
      case 'permission':
        markers.push({ at: event.at, kind: 'wait', agent: timelapse.agents[event.agent]?.name ?? '', project: projectOf(event.agent), detail: event.tool, durationMs: event.durationMs, count: 1 });
        break;
      case 'arrive':
        if (timelapse.agents[event.agent]?.kind === 'main') markers.push({ at: event.at, kind: 'arrival', agent: timelapse.agents[event.agent]?.name ?? '', project: projectOf(event.agent), count: 1 });
        break;
      default:
        break;
    }
  }
  return markers;
}

/** The marks of a day; marks of one kind closer than `mergeMs` become one (the earliest, with a count). */
export function buildMarkers(timelapse: Timelapse, mergeMs: number): Marker[] {
  const merged: Marker[] = [];
  const lastOf = new Map<MarkerKind, number>();
  for (const marker of raw(timelapse)) {
    const previous = lastOf.get(marker.kind);
    const into = previous === undefined ? undefined : merged[previous];
    if (into !== undefined && marker.at - into.at < mergeMs) {
      merged[previous as number] = { ...into, count: into.count + marker.count };
      continue;
    }
    lastOf.set(marker.kind, merged.length);
    merged.push(marker);
  }
  return merged.sort((a, b) => a.at - b.at || PRIORITY[a.kind] - PRIORITY[b.kind]);
}

/** The mark closest to `at` within `toleranceMs`; on a tie the more important one. */
export function markerNear(markers: readonly Marker[], at: number, toleranceMs: number): Marker | undefined {
  let best: Marker | undefined;
  for (const marker of markers) {
    const distance = Math.abs(marker.at - at);
    if (distance > toleranceMs) continue;
    if (best === undefined) best = marker;
    else {
      const bestDistance = Math.abs(best.at - at);
      if (distance < bestDistance || (distance === bestDistance && PRIORITY[marker.kind] < PRIORITY[best.kind])) best = marker;
    }
  }
  return best;
}
