// What the achievements dialog shows, as pure functions: texts keys, the order of the badges, the next unlock.
import { DECOR_LEVELS, MAX_LEVEL, type AchievementId, type AchievementState, type DecorId } from '@ai-office/shared';
import type { UiKey } from '../../i18n';

export function levelTitleKey(level: number): UiKey {
  const clamped = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  return `progress.level.title.${clamped}` as UiKey;
}

export function achievementNameKey(id: AchievementId): UiKey {
  return `progress.ach.${id}.name` as UiKey;
}

export function achievementHowKey(id: AchievementId): UiKey {
  return `progress.ach.${id}.how` as UiKey;
}

export function decorNameKey(id: DecorId): UiKey {
  return `progress.decor.${id}` as UiKey;
}

/** Earned ones first (newest first), then the locked ones closest to their goal. */
export function sortAchievements(list: readonly AchievementState[]): AchievementState[] {
  const fraction = (item: AchievementState): number => (item.target === 0 ? 0 : item.value / item.target);
  return [...list].sort((a, b) => {
    if (a.unlockedAt !== undefined && b.unlockedAt !== undefined) return b.unlockedAt - a.unlockedAt;
    if (a.unlockedAt !== undefined) return -1;
    if (b.unlockedAt !== undefined) return 1;
    return fraction(b) - fraction(a);
  });
}

export function earnedCount(list: readonly AchievementState[]): number {
  return list.filter((item) => item.unlockedAt !== undefined).length;
}

export interface DecorRow {
  id: DecorId;
  level: number;
  unlocked: boolean;
}

/** Every piece of decoration with the level that unlocks it, in the order they arrive. */
export function decorRows(level: number): DecorRow[] {
  return (Object.keys(DECOR_LEVELS) as DecorId[])
    .map((id) => ({ id, level: DECOR_LEVELS[id], unlocked: DECOR_LEVELS[id] <= level }))
    .sort((a, b) => a.level - b.level);
}
