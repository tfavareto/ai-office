// Keeps a time-lapse within its event budget. The structure of the day (arrivals, departures, status changes, waits,
// commits, tests, task lists, shells) is never touched while it fits; what goes first is the stream of ordinary
// activities, thinned with a growing minimum gap per agent, then dropped altogether.
import { type TimelapseEvent, TIMELAPSE_MAX_EVENTS } from '@ai-office/shared';

/** Activities of these kinds are the story of the day: they stay while anything else can go. */
const KEY_KINDS: ReadonlySet<string> = new Set(['prompt', 'error', 'done', 'subagent', 'question', 'permission']);
const FIRST_GAP_MS = 10_000;
const LAST_GAP_MS = 3_600_000;

function isOrdinaryActivity(event: TimelapseEvent): boolean {
  return event.type === 'activity' && !KEY_KINDS.has(event.kind);
}

/** Drops ordinary activities that follow another kept one of the same agent by less than `gap`. */
function thin(events: readonly TimelapseEvent[], gap: number): TimelapseEvent[] {
  const lastKept = new Map<number, number>();
  return events.filter((event) => {
    if (event.type !== 'activity' || !isOrdinaryActivity(event)) return true;
    const last = lastKept.get(event.agent);
    if (last !== undefined && event.at - last < gap) return false;
    lastKept.set(event.agent, event.at);
    return true;
  });
}

/** Task lists change often; once the budget is tight only the last change of each minute per agent stays. */
function thinTasks(events: readonly TimelapseEvent[]): TimelapseEvent[] {
  const lastMinute = new Map<number, number>();
  const kept: TimelapseEvent[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as TimelapseEvent;
    if (event.type === 'tasks') {
      const minute = Math.floor(event.at / 60_000);
      if (lastMinute.get(event.agent) === minute) continue;
      lastMinute.set(event.agent, minute);
    }
    kept.push(event);
  }
  return kept.reverse();
}

export interface Fitted {
  events: TimelapseEvent[];
  trimmed: boolean;
}

/** `events` must be time ordered. */
export function fitEvents(events: readonly TimelapseEvent[], max = TIMELAPSE_MAX_EVENTS): Fitted {
  if (events.length <= max) return { events: [...events], trimmed: false };
  let current: TimelapseEvent[] = [...events];
  for (let gap = FIRST_GAP_MS; gap <= LAST_GAP_MS && current.length > max; gap *= 2) current = thin(current, gap);
  if (current.length > max) current = current.filter((event) => !isOrdinaryActivity(event));
  if (current.length > max) current = thinTasks(current);
  if (current.length > max) current = current.filter((event) => event.type !== 'activity');
  return { events: current.length > max ? current.slice(0, max) : current, trimmed: true };
}
