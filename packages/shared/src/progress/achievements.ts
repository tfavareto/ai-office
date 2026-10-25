// The achievements: each one is a threshold on one lifetime number, so the same table drives the unlock rule, the
// progress bar of a locked one and the replay that finds the day an old achievement was earned.
import type { AchievementDef, AchievementId, Cumulative } from './types';

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'firstSession', metric: 'sessions', target: 1, tier: 'bronze' },
  { id: 'firstCommit', metric: 'commits', target: 1, tier: 'bronze' },
  { id: 'firstTestPass', metric: 'testsPassed', target: 1, tier: 'bronze' },
  { id: 'tasks10', metric: 'tasks', target: 10, tier: 'bronze' },
  { id: 'timelapse', metric: 'timelapseSeen', target: 1, tier: 'bronze' },
  { id: 'share', metric: 'shareSeen', target: 1, tier: 'bronze' },
  { id: 'nightOwl', metric: 'nightDays', target: 1, tier: 'bronze' },
  { id: 'earlyBird', metric: 'earlyDays', target: 1, tier: 'bronze' },
  { id: 'weekend', metric: 'weekendDays', target: 1, tier: 'bronze' },
  { id: 'team5', metric: 'peakAgents', target: 5, tier: 'silver' },
  { id: 'sessions50', metric: 'sessions', target: 50, tier: 'silver' },
  { id: 'tasks100', metric: 'tasks', target: 100, tier: 'silver' },
  { id: 'commits100', metric: 'commits', target: 100, tier: 'silver' },
  { id: 'tests100', metric: 'testsPassed', target: 100, tier: 'silver' },
  { id: 'streak7', metric: 'bestStreak', target: 7, tier: 'silver' },
  { id: 'subagents10', metric: 'peakSubagents', target: 10, tier: 'silver' },
  { id: 'days30', metric: 'daysActive', target: 30, tier: 'silver' },
  { id: 'tokens10m', metric: 'tokens', target: 10_000_000, tier: 'silver' },
  { id: 'hours100', metric: 'activeHours', target: 100, tier: 'gold' },
  { id: 'streak30', metric: 'bestStreak', target: 30, tier: 'gold' },
  { id: 'tasks1000', metric: 'tasks', target: 1000, tier: 'gold' },
  { id: 'tokens1b', metric: 'tokens', target: 1_000_000_000, tier: 'gold' },
];

export const ACHIEVEMENT_IDS: readonly AchievementId[] = ACHIEVEMENTS.map((def) => def.id);

const BY_ID = new Map(ACHIEVEMENTS.map((def) => [def.id, def]));

export function achievementDef(id: AchievementId): AchievementDef | undefined {
  return BY_ID.get(id);
}

export function isAchievementId(value: unknown): value is AchievementId {
  return typeof value === 'string' && BY_ID.has(value as AchievementId);
}

/** The achievements whose threshold the numbers have reached. */
export function reached(counters: Cumulative): AchievementId[] {
  return ACHIEVEMENTS.filter((def) => counters[def.metric] >= def.target).map((def) => def.id);
}
