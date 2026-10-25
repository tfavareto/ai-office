// Defensive parsing of the progress that travels in the snapshot and of GET /api/progress: numbers are checked and
// bounded, texts are cut, unknown achievements are dropped.
import {
  ACHIEVEMENTS,
  MAX_RECENT_UNLOCKS,
  achievementDef,
  levelOf,
  type AchievementState,
  type EmployeeOfTheMonth,
  type Progress,
  type ProgressStats,
  type ProgressSummary,
  type RecentUnlock,
} from '@ai-office/shared';
import { isRecord } from './parse';

const MAX_VALUE = 1e13;
const MAX_NAME = 80;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_VALUE, Math.max(0, Math.floor(value))) : 0;
}

function name(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, MAX_NAME) : undefined;
}

function recent(value: unknown): RecentUnlock[] {
  if (!Array.isArray(value)) return [];
  const found: RecentUnlock[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.at !== 'number') continue;
    const def = achievementDef(entry.id as never);
    if (def !== undefined) found.push({ id: def.id, at: count(entry.at) });
  }
  return found.slice(0, MAX_RECENT_UNLOCKS);
}

/** The summary in a snapshot, or undefined when absent or not shaped like one. */
export function parseProgressSummary(value: unknown): ProgressSummary | undefined {
  if (!isRecord(value) || typeof value.xp !== 'number') return undefined;
  const info = levelOf(count(value.xp));
  const employee = name(value.employee);
  return {
    level: info.level,
    xp: info.xp,
    from: info.from,
    to: info.to,
    achievements: Math.min(ACHIEVEMENTS.length, count(value.achievements)),
    total: ACHIEVEMENTS.length,
    recent: recent(value.recent),
    ...(employee !== undefined ? { employee } : {}),
    ...(value.demo === true ? { demo: true } : {}),
  };
}

function stats(value: unknown): ProgressStats {
  const data = isRecord(value) ? value : {};
  return {
    sessions: count(data.sessions),
    activeMs: count(data.activeMs),
    tasks: count(data.tasks),
    commits: count(data.commits),
    testsPassed: count(data.testsPassed),
    tokens: count(data.tokens),
    subagents: count(data.subagents),
    daysActive: count(data.daysActive),
    currentStreak: count(data.currentStreak),
    bestStreak: count(data.bestStreak),
    peakAgents: count(data.peakAgents),
  };
}

function achievements(value: unknown): AchievementState[] {
  const sent = new Map<string, Record<string, unknown>>();
  if (Array.isArray(value))
    for (const entry of value) if (isRecord(entry) && typeof entry.id === 'string') sent.set(entry.id, entry);
  // The catalog is the page's: an achievement the server did not send is shown locked at zero.
  return ACHIEVEMENTS.map((def) => {
    const entry = sent.get(def.id);
    const unlockedAt =
      entry !== undefined && typeof entry.unlockedAt === 'number' ? count(entry.unlockedAt) : undefined;
    return {
      id: def.id,
      tier: def.tier,
      ...(unlockedAt !== undefined ? { unlockedAt } : {}),
      value: Math.min(def.target, count(entry?.value)),
      target: def.target,
    };
  });
}

function employee(value: unknown): EmployeeOfTheMonth | undefined {
  if (!isRecord(value)) return undefined;
  const who = name(value.name);
  if (who === undefined) return undefined;
  const project = name(value.project);
  return { name: who, tasks: count(value.tasks), ...(project !== undefined ? { project } : {}) };
}

export function parseProgress(data: unknown): Progress {
  const root = isRecord(data) ? data : {};
  const level = isRecord(root.level) ? levelOf(count(root.level.xp)) : levelOf(0);
  const who = employee(root.employee);
  return {
    level,
    stats: stats(root.stats),
    achievements: achievements(root.achievements),
    ...(who !== undefined ? { employee: who } : {}),
    ...(typeof root.since === 'string' && DATE_PATTERN.test(root.since) ? { since: root.since } : {}),
    ...(root.counting === true ? { counting: true } : {}),
    ...(root.demo === true ? { demo: true } : {}),
  };
}
