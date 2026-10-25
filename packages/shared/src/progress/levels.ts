// The office level: XP from the lifetime counters, ten levels, and what each level unlocks. Pure and monotonic: more
// work never lowers the XP, so the level (kept as a high-water mark by the server) never goes down either.
import type { Cumulative, DecorId, LevelInfo } from './types';

/**
 * XP weights. A busy day (8 sessions, 6 active hours, 20 tasks, 5 commits, 10 passing test runs, 15 M tokens, 4
 * subagents) is about 490 XP, a light one around 60.
 */
export const XP_WEIGHTS = {
  session: 10,
  activeHour: 20,
  task: 5,
  commit: 20,
  testPassed: 3,
  tokenMillion: 2,
  subagent: 2,
  dayActive: 25,
  achievement: 40,
} as const;

/** XP at which each level starts (index 0 is level 1). Roughly a week of busy days per level at the start, ten weeks at the top. */
export const LEVEL_THRESHOLDS: readonly number[] = [0, 150, 500, 1200, 2500, 5000, 9000, 15000, 25000, 40000];

export const MAX_LEVEL = LEVEL_THRESHOLDS.length;

export function xpOf(counters: Cumulative, achievements: number): number {
  return (
    counters.sessions * XP_WEIGHTS.session +
    counters.activeHours * XP_WEIGHTS.activeHour +
    counters.tasks * XP_WEIGHTS.task +
    counters.commits * XP_WEIGHTS.commit +
    counters.testsPassed * XP_WEIGHTS.testPassed +
    Math.floor(counters.tokens / 1_000_000) * XP_WEIGHTS.tokenMillion +
    counters.subagents * XP_WEIGHTS.subagent +
    counters.daysActive * XP_WEIGHTS.dayActive +
    achievements * XP_WEIGHTS.achievement
  );
}

export function levelOf(xp: number): LevelInfo {
  const safe = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
  let index = 0;
  while (index + 1 < LEVEL_THRESHOLDS.length && safe >= LEVEL_THRESHOLDS[index + 1]) index++;
  return {
    level: index + 1,
    xp: safe,
    from: LEVEL_THRESHOLDS[index],
    to: index + 1 < LEVEL_THRESHOLDS.length ? LEVEL_THRESHOLDS[index + 1] : null,
  };
}

/** The level an XP total belongs to, as a fraction of the way to the next one (1 at the last level). */
export function levelFraction(info: Pick<LevelInfo, 'xp' | 'from' | 'to'>): number {
  if (info.to === null) return 1;
  return Math.min(1, Math.max(0, (info.xp - info.from) / (info.to - info.from)));
}

/** The level at which each piece of decoration appears. Level 1 is the plain office. */
export const DECOR_LEVELS: Readonly<Record<DecorId, number>> = {
  wallArt: 2,
  employeePlaque: 3,
  aquarium: 4,
  trophyCabinet: 5,
  pet: 6,
  neonSign: 7,
  arcade: 8,
  stringLights: 9,
  goldFinish: 10,
};

export const DECOR_IDS: readonly DecorId[] = (Object.keys(DECOR_LEVELS) as DecorId[]).sort(
  (a, b) => DECOR_LEVELS[a] - DECOR_LEVELS[b],
);

/** Everything unlocked at `level` (a level reached once stays: callers pass the high-water mark). */
export function decorForLevel(level: number): ReadonlySet<DecorId> {
  return new Set(DECOR_IDS.filter((id) => DECOR_LEVELS[id] <= level));
}

/** What the next level brings, or undefined at the top. */
export function nextDecor(level: number): { id: DecorId; level: number } | undefined {
  const id = DECOR_IDS.find((candidate) => DECOR_LEVELS[candidate] > level);
  return id === undefined ? undefined : { id, level: DECOR_LEVELS[id] };
}
