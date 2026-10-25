import { describe, expect, test } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENT_IDS, achievementDef, isAchievementId, reached } from './achievements';
import { cumulativeOf, emptyState } from './ledger';

const NONE = cumulativeOf(emptyState());

describe('achievements', () => {
  test('are about twenty, with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENTS.length);
  });

  test('nothing is earned by an empty office', () => {
    expect(reached(NONE)).toEqual([]);
  });

  test('the first session, commit and task milestones unlock at their thresholds', () => {
    expect(reached({ ...NONE, sessions: 1 })).toEqual(['firstSession']);
    expect(reached({ ...NONE, commits: 1 })).toEqual(['firstCommit']);
    expect(reached({ ...NONE, tasks: 99 })).toEqual(['tasks10']);
    expect(reached({ ...NONE, tasks: 100 })).toEqual(expect.arrayContaining(['tasks10', 'tasks100']));
    expect(reached({ ...NONE, tasks: 1000 })).toContain('tasks1000');
  });

  test('a streak of seven days unlocks the week, not the month', () => {
    const earned = reached({ ...NONE, bestStreak: 7 });
    expect(earned).toContain('streak7');
    expect(earned).not.toContain('streak30');
  });

  test('five agents at once and ten subagents in a day have their own badges', () => {
    expect(reached({ ...NONE, peakAgents: 5 })).toContain('team5');
    expect(reached({ ...NONE, peakSubagents: 10 })).toContain('subagents10');
    expect(reached({ ...NONE, peakSubagents: 9 })).not.toContain('subagents10');
  });

  test('the habits badges need a day of that kind', () => {
    expect(reached({ ...NONE, nightDays: 1 })).toEqual(['nightOwl']);
    expect(reached({ ...NONE, earlyDays: 1 })).toEqual(['earlyBird']);
    expect(reached({ ...NONE, weekendDays: 1 })).toEqual(['weekend']);
  });

  test('looks an achievement up and recognises ids', () => {
    expect(achievementDef('tasks100')?.target).toBe(100);
    expect(isAchievementId('tasks100')).toBe(true);
    expect(isAchievementId('nope')).toBe(false);
    expect(isAchievementId(3)).toBe(false);
  });
});
