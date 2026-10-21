// The order of a time-lapse's events: by time, and for events at the same instant in the order that keeps a person's
// story consistent (arrives, gets a status, does things, leaves).
import type { TimelapseEvent } from './types';

const RANK: Readonly<Record<TimelapseEvent['type'], number>> = { arrive: 0, status: 1, tasks: 2, shell: 3, activity: 4, permission: 5, test: 6, commit: 7, leave: 8 };

export function compareEvents(a: TimelapseEvent, b: TimelapseEvent): number {
  return a.at - b.at || RANK[a.type] - RANK[b.type];
}

/** A time ordered copy (the sort is stable, so events of the same kind at the same instant keep their order). */
export function sortEvents(events: readonly TimelapseEvent[]): TimelapseEvent[] {
  return [...events].sort(compareEvents);
}
