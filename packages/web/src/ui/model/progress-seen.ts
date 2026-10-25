// What has already been announced: the page remembers the level and the unlocks it showed, so a toast appears once per
// news and never for the history that was counted before the page opened.
import { isAchievementId, type AchievementId, type ProgressSummary } from '@ai-office/shared';

export const SEEN_KEY = 'ai-office:progress-seen';
const MAX_IDS = 64;

export interface Seen {
  level: number;
  count: number;
  ids: readonly AchievementId[];
}

export interface Announcements {
  /** The level reached, when it is higher than the one announced last. */
  level?: number;
  /** Achievements earned since last time that the summary names. */
  unlocked: AchievementId[];
  /** Achievements earned since last time, named or not. */
  count: number;
  next: Seen;
}

export function seenFrom(summary: ProgressSummary): Seen {
  return { level: summary.level, count: summary.achievements, ids: summary.recent.map((unlock) => unlock.id) };
}

/**
 * Compares what the server says with what was announced. With nothing announced yet the summary is simply taken as
 * the starting point (the first run counts the whole history at once and must not shower the person in toasts).
 */
export function announcements(seen: Seen | null, summary: ProgressSummary): Announcements {
  if (seen === null) return { unlocked: [], count: 0, next: seenFrom(summary) };
  const unlocked = summary.recent.map((unlock) => unlock.id).filter((id) => !seen.ids.includes(id));
  const count = Math.max(unlocked.length, summary.achievements - seen.count);
  const level = summary.level > seen.level ? summary.level : undefined;
  const ids = [...new Set([...unlocked, ...seen.ids])].slice(0, MAX_IDS);
  return {
    ...(level !== undefined ? { level } : {}),
    unlocked,
    count: Math.max(0, count),
    next: { level: Math.max(seen.level, summary.level), count: Math.max(seen.count, summary.achievements), ids },
  };
}

export function parseSeen(text: string | null): Seen | null {
  if (text === null) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return null;
    const record = data as Record<string, unknown>;
    const level = record.level;
    const count = record.count;
    if (typeof level !== 'number' || !Number.isFinite(level) || typeof count !== 'number' || !Number.isFinite(count))
      return null;
    const ids = Array.isArray(record.ids) ? record.ids.filter(isAchievementId).slice(0, MAX_IDS) : [];
    return { level: Math.max(1, Math.floor(level)), count: Math.max(0, Math.floor(count)), ids };
  } catch {
    return null;
  }
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSeen(storage: Storage | null = defaultStorage()): Seen | null {
  try {
    return parseSeen(storage?.getItem(SEEN_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveSeen(seen: Seen, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Storage unavailable: the person may see a toast twice, nothing else.
  }
}
