// Activity timeline: merges the live "recent" list with the long history fetched from /api/history.
import type { Activity, Agent, OfficeSnapshot } from '@ai-office/shared';

export const MAX_TIMELINE = 300;

/** Newest first, deduplicated by id. */
export function mergeTimeline(
  recent: readonly Activity[],
  history: readonly Activity[],
  max = MAX_TIMELINE,
): Activity[] {
  const byId = new Map<string, Activity>();
  for (const activity of history) byId.set(activity.id, activity);
  for (const activity of recent) byId.set(activity.id, activity);
  return [...byId.values()].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, max);
}

export interface RoomActivity {
  agent: Agent;
  activity: Activity;
}

/** Latest activities across the agents of a room, newest first. */
export function roomActivities(agents: readonly Agent[], limit = 12): RoomActivity[] {
  return agents
    .flatMap((agent) => agent.recent.map((activity) => ({ agent, activity })))
    .sort((a, b) => b.activity.at - a.activity.at)
    .slice(0, limit);
}

export function snapshotAgent(snapshot: OfficeSnapshot | null, id: string): Agent | undefined {
  return snapshot?.agents.find((agent) => agent.id === id);
}
