// Session history: search and grouping by day.
import type { RecentSession } from '@ai-office/shared';
import { formatDayLabel, startOfDay } from '../format';
import { normalizeQuery } from './rooms';

export interface SessionDayGroup {
  key: number;
  label: string;
  sessions: RecentSession[];
}

export function filterSessions(sessions: readonly RecentSession[], query: string): RecentSession[] {
  const q = normalizeQuery(query);
  if (!q) return [...sessions];
  return sessions.filter((session) => {
    const haystack = normalizeQuery(
      [session.projectName, session.projectPath, session.title].filter(Boolean).join(' '),
    );
    return q.split(/\s+/).every((term) => haystack.includes(term));
  });
}

/** Groups sessions by the local day of their last activity, newest day and newest session first. */
export function groupSessionsByDay(sessions: readonly RecentSession[], now: number): SessionDayGroup[] {
  const groups = new Map<number, RecentSession[]>();
  for (const session of sessions) {
    const key = startOfDay(session.lastAt);
    const list = groups.get(key);
    if (list) list.push(session);
    else groups.set(key, [session]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([key, list]) => ({
      key,
      label: formatDayLabel(key, now),
      sessions: list.sort((a, b) => b.lastAt - a.lastAt),
    }));
}
