import { describe, expect, test } from 'vitest';
import { dayFacts } from './fixtures';
import {
  DECOR_IDS,
  DECOR_LEVELS,
  LEVEL_THRESHOLDS,
  MAX_LEVEL,
  decorForLevel,
  levelFraction,
  levelOf,
  nextDecor,
  xpOf,
} from './levels';
import { cumulativeOf, emptyState, withDay } from './ledger';

describe('levelOf', () => {
  test('starts at level 1 with no xp', () => {
    expect(levelOf(0)).toEqual({ level: 1, xp: 0, from: 0, to: 150 });
  });

  test('moves up exactly at each threshold', () => {
    LEVEL_THRESHOLDS.forEach((threshold, index) => {
      expect(levelOf(threshold).level).toBe(index + 1);
      if (threshold > 0) expect(levelOf(threshold - 1).level).toBe(index);
    });
  });

  test('stops at the last level and has nothing above it', () => {
    const top = levelOf(10_000_000);
    expect(top.level).toBe(MAX_LEVEL);
    expect(top.to).toBeNull();
  });

  test('treats nonsense as zero', () => {
    expect(levelOf(Number.NaN).level).toBe(1);
    expect(levelOf(-50).xp).toBe(0);
  });

  test('has ten levels with strictly increasing thresholds', () => {
    expect(MAX_LEVEL).toBe(10);
    LEVEL_THRESHOLDS.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(LEVEL_THRESHOLDS[index]));
  });
});

describe('levelFraction', () => {
  test('is the way through the current level', () => {
    expect(levelFraction({ xp: 75, from: 0, to: 150 })).toBe(0.5);
  });

  test('is full at the last level', () => {
    expect(levelFraction({ xp: 99999, from: 40000, to: null })).toBe(1);
  });
});

describe('xpOf', () => {
  test('is monotonic: more of anything never lowers it', () => {
    const base = cumulativeOf(withDay(emptyState(), dayFacts('2026-10-01', { tasks: 3 }), 0));
    const before = xpOf(base, 1);
    for (const key of [
      'sessions',
      'activeHours',
      'tasks',
      'commits',
      'testsPassed',
      'tokens',
      'subagents',
      'daysActive',
    ] as const) {
      expect(xpOf({ ...base, [key]: base[key] + 1_000_000 }, 1)).toBeGreaterThan(before);
    }
    expect(xpOf(base, 2)).toBeGreaterThan(before);
  });

  test('a busy day is worth about five hundred xp', () => {
    const state = withDay(
      emptyState(),
      dayFacts('2026-10-01', {
        sessions: 8,
        activeMs: 6 * 3_600_000,
        tasks: 20,
        commits: 5,
        testsPassed: 10,
        tokens: 15_000_000,
        subagents: 4,
      }),
      0,
    );
    const xp = xpOf(cumulativeOf(state), 0);
    expect(xp).toBeGreaterThan(400);
    expect(xp).toBeLessThan(600);
  });
});

describe('decor', () => {
  test('level 1 is the plain office', () => {
    expect(decorForLevel(1).size).toBe(0);
  });

  test('each level up to ten adds exactly one thing', () => {
    for (let level = 2; level <= MAX_LEVEL; level++)
      expect(decorForLevel(level).size - decorForLevel(level - 1).size).toBe(1);
    expect(DECOR_IDS).toHaveLength(MAX_LEVEL - 1);
  });

  test('a level reached keeps everything it unlocked', () => {
    for (const id of DECOR_IDS) expect(decorForLevel(DECOR_LEVELS[id]).has(id)).toBe(true);
    expect(decorForLevel(6).has('pet')).toBe(true);
    expect(decorForLevel(5).has('pet')).toBe(false);
  });

  test('previews the next unlock and nothing at the top', () => {
    expect(nextDecor(1)).toEqual({ id: 'wallArt', level: 2 });
    expect(nextDecor(6)).toEqual({ id: 'neonSign', level: 7 });
    expect(nextDecor(MAX_LEVEL)).toBeUndefined();
  });
});
