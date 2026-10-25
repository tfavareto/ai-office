import { describe, expect, test } from 'vitest';
import { ACHIEVEMENTS, DECOR_IDS, MAX_LEVEL, type AchievementState } from '@ai-office/shared';
import { UI_CATALOGS } from '../../i18n/ui';
import {
  achievementHowKey,
  achievementNameKey,
  decorNameKey,
  decorRows,
  earnedCount,
  levelTitleKey,
  sortAchievements,
} from './progress-view';

const state = (id: AchievementState['id'], over: Partial<AchievementState> = {}): AchievementState => ({
  id,
  tier: 'bronze',
  value: 0,
  target: 10,
  ...over,
});

describe('sortAchievements', () => {
  test('earned ones come first, newest first, then the locked ones closest to done', () => {
    const sorted = sortAchievements([
      state('tasks10', { value: 2 }),
      state('tasks100', { unlockedAt: 100 }),
      state('commits100', { value: 9 }),
      state('firstCommit', { unlockedAt: 200 }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['firstCommit', 'tasks100', 'commits100', 'tasks10']);
  });

  test('does not change its input', () => {
    const input = [state('tasks10'), state('tasks100', { unlockedAt: 1 })];

    sortAchievements(input);

    expect(input[0]?.id).toBe('tasks10');
  });

  test('counts the earned ones', () => {
    expect(earnedCount([state('tasks10', { unlockedAt: 1 }), state('tasks100')])).toBe(1);
  });
});

describe('texts', () => {
  test('every level, achievement and decoration has a name in every language', () => {
    for (const locale of ['pt-BR', 'en', 'es'] as const) {
      const catalog = UI_CATALOGS[locale] as Record<string, string>;
      for (let level = 1; level <= MAX_LEVEL; level++)
        expect(catalog[levelTitleKey(level)], `${locale} level ${level}`).toBeTruthy();
      for (const def of ACHIEVEMENTS) {
        expect(catalog[achievementNameKey(def.id)], `${locale} ${def.id}`).toBeTruthy();
        expect(catalog[achievementHowKey(def.id)], `${locale} ${def.id} how`).toBeTruthy();
      }
      for (const id of DECOR_IDS) expect(catalog[decorNameKey(id)], `${locale} ${id}`).toBeTruthy();
    }
  });

  test('clamps a level out of range', () => {
    expect(levelTitleKey(0)).toBe('progress.level.title.1');
    expect(levelTitleKey(99)).toBe('progress.level.title.10');
  });
});

describe('decor', () => {
  test('lists the decoration in the order it arrives with what the level has unlocked', () => {
    const rows = decorRows(5);

    expect(rows.map((row) => row.level)).toEqual([...rows.map((row) => row.level)].sort((a, b) => a - b));
    expect(rows.filter((row) => row.unlocked).map((row) => row.id)).toEqual([
      'wallArt',
      'employeePlaque',
      'aquarium',
      'trophyCabinet',
    ]);
  });
});
