import { describe, expect, test } from 'vitest';
import { useTimeZone } from '../usage/test-zone';
import { dayFacts } from './fixtures';
import {
  DETAILED_DAYS,
  bestStreakOf,
  buildProgress,
  buildSummary,
  cumulativeOf,
  currentStreak,
  emptyState,
  employeeOfTheMonth,
  settle,
  withDay,
  withEvent,
  withPeakAgents,
  withSettled,
  type ProgressState,
} from './ledger';

useTimeZone('America/Sao_Paulo');

const NOW = new Date(2026, 9, 21, 15, 0).getTime();

function stateWith(...days: ReturnType<typeof dayFacts>[]): ProgressState {
  return days.reduce((state, facts) => withDay(state, facts, NOW), emptyState());
}

describe('withDay', () => {
  test('processing the same day twice counts it once', () => {
    const facts = dayFacts('2026-10-20', { tasks: 4, commits: 2 });
    const once = stateWith(facts);
    const twice = withDay(once, facts, NOW);

    expect(cumulativeOf(twice)).toEqual(cumulativeOf(once));
  });

  test('a later reading of a day replaces the earlier one', () => {
    const state = withDay(stateWith(dayFacts('2026-10-21', { tasks: 2 })), dayFacts('2026-10-21', { tasks: 5 }), NOW);

    expect(cumulativeOf(state).tasks).toBe(5);
  });

  test('does not change the state it was given', () => {
    const before = emptyState();
    withDay(before, dayFacts('2026-10-20', { tasks: 1 }), NOW);

    expect(before.days).toEqual({});
  });

  test('folds days older than the detailed window into the base without losing the totals', () => {
    const old = new Date(2026, 9, 21 - DETAILED_DAYS - 5);
    const oldDate = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, '0')}-${String(old.getDate()).padStart(2, '0')}`;
    const state = stateWith(dayFacts(oldDate, { tasks: 7, sessions: 2 }), dayFacts('2026-10-21', { tasks: 3 }));

    expect(Object.keys(state.days)).toEqual(['2026-10-21']);
    expect(cumulativeOf(state).tasks).toBe(10);
    expect(cumulativeOf(state).sessions).toBe(3);
    expect(cumulativeOf(state).daysActive).toBe(2);
  });
});

describe('streaks', () => {
  const dates = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21'];

  test('the best streak is the longest run of consecutive days', () => {
    expect(bestStreakOf(dates)).toBe(3);
  });

  test('the current streak runs through today', () => {
    expect(currentStreak(dates, '2026-10-21')).toBe(3);
  });

  test('stays alive through yesterday while today has not started', () => {
    expect(currentStreak(['2026-10-19', '2026-10-20'], '2026-10-21')).toBe(2);
  });

  test('is broken after a missed day', () => {
    expect(currentStreak(['2026-10-18', '2026-10-19'], '2026-10-21')).toBe(0);
  });

  test('crosses a month and a year boundary', () => {
    expect(bestStreakOf(['2026-12-30', '2026-12-31', '2027-01-01'])).toBe(3);
    expect(bestStreakOf(['2026-02-28', '2026-03-01'])).toBe(2);
  });
});

describe('settle', () => {
  test('unlocks an achievement with the day it was reached', () => {
    const state = stateWith(dayFacts('2026-10-10', { commits: 1 }), dayFacts('2026-10-12', { commits: 2 }));

    const { state: settled, unlocked } = settle(state, NOW);

    expect(unlocked).toContain('firstCommit');
    const reachedAt = settled.unlocks.firstCommit as number;
    expect(new Date(reachedAt).getDate()).toBe(10);
  });

  test('keeps the date of an unlock it already knew', () => {
    const first = settle(stateWith(dayFacts('2026-10-10', { commits: 1 })), NOW).state;
    const again = settle(withDay(first, dayFacts('2026-10-11', { commits: 3 }), NOW), NOW + 1000);

    expect(again.state.unlocks.firstCommit).toBe(first.unlocks.firstCommit);
    expect(again.unlocked).not.toContain('firstCommit');
  });

  test('is idempotent', () => {
    const once = settle(stateWith(dayFacts('2026-10-10', { tasks: 12 })), NOW);
    const twice = settle(once.state, NOW);

    expect(twice.state).toEqual(once.state);
    expect(twice.unlocked).toEqual([]);
  });

  test('the level never goes down when the numbers shrink', () => {
    const big = settle(
      stateWith(dayFacts('2026-10-10', { sessions: 40, tasks: 400, activeMs: 100 * 3_600_000 })),
      NOW,
    ).state;
    const high = buildSummary(big, NOW).level;
    const smaller = settle({ ...big, days: {}, base: { ...big.base } }, NOW).state;

    expect(high).toBeGreaterThan(1);
    expect(buildSummary(smaller, NOW).level).toBe(high);
  });

  test('earns the streak badge from the days in a row', () => {
    const days = Array.from({ length: 7 }, (_, i) => dayFacts(`2026-10-${String(10 + i).padStart(2, '0')}`));

    expect(settle(stateWith(...days), NOW).unlocked).toContain('streak7');
  });

  test('dates the page-only badges to the moment the page said so', () => {
    const state = withEvent(emptyState(), 'timelapse', NOW - 5000);
    const { state: settled } = settle(state, NOW);

    expect(settled.unlocks.timelapse).toBe(NOW - 5000);
  });

  test('the first event counts and later ones change nothing', () => {
    const once = withEvent(emptyState(), 'share', 100);

    expect(withEvent(once, 'share', 900).events.share).toBe(100);
  });

  test('counts the peak of agents at once seen live', () => {
    const state = withPeakAgents(emptyState(), 5);

    expect(settle(state, NOW).unlocked).toContain('team5');
    expect(withPeakAgents(state, 3)).toBe(state);
  });

  test('marks days as settled without going backwards', () => {
    const state = withSettled(withSettled(emptyState(), '2026-10-20'), '2026-10-10');

    expect(state.settledThrough).toBe('2026-10-20');
  });
});

describe('employee of the month', () => {
  const days = {
    '2026-10-02': dayFacts('2026-10-02', {
      workers: [
        { name: 'Ana', project: 'loja', tasks: 3 },
        { name: 'Bruno', project: 'api', tasks: 4 },
      ],
    }),
    '2026-10-03': dayFacts('2026-10-03', { workers: [{ name: 'Ana', project: 'app', tasks: 2 }] }),
    '2026-09-30': dayFacts('2026-09-30', { workers: [{ name: 'Carla', project: 'x', tasks: 99 }] }),
  };

  test('is the agent with the most tasks in the month, only that month', () => {
    expect(employeeOfTheMonth(days, '2026-10')).toEqual({ name: 'Ana', tasks: 5, project: 'loja' });
  });

  test('is nobody in a month without tasks', () => {
    expect(employeeOfTheMonth(days, '2026-11')).toBeUndefined();
  });

  test('breaks a tie by name so the answer is stable', () => {
    const tied = {
      '2026-10-01': dayFacts('2026-10-01', {
        workers: [
          { name: 'Zeca', project: 'p', tasks: 2 },
          { name: 'Ana', project: 'p', tasks: 2 },
        ],
      }),
    };

    expect(employeeOfTheMonth(tied, '2026-10')?.name).toBe('Ana');
  });

  test('the summary carries the name only and the endpoint adds the project on request', () => {
    const state = stateWith(...Object.values(days));

    expect(buildSummary(state, NOW).employee).toBe('Ana');
    expect(buildProgress(state, { now: NOW, includeProject: false, counting: false }).employee).toEqual({
      name: 'Ana',
      tasks: 5,
    });
    expect(buildProgress(state, { now: NOW, includeProject: true, counting: false }).employee?.project).toBe('loja');
  });
});

describe('buildProgress', () => {
  test('lists every achievement with its progress and the since date', () => {
    const state = settle(
      stateWith(dayFacts('2026-10-10', { tasks: 4 }), dayFacts('2026-10-11', { tasks: 4 })),
      NOW,
    ).state;

    const progress = buildProgress(state, { now: NOW, includeProject: false, counting: true });
    const tasks100 = progress.achievements.find((entry) => entry.id === 'tasks100');

    expect(progress.since).toBe('2026-10-10');
    expect(progress.counting).toBe(true);
    expect(tasks100).toMatchObject({ value: 8, target: 100 });
    expect(tasks100?.unlockedAt).toBeUndefined();
    expect(progress.stats.tasks).toBe(8);
  });

  test('the summary lists the newest unlocks first', () => {
    const state = settle(
      stateWith(dayFacts('2026-10-10', { commits: 1 }), dayFacts('2026-10-12', { tasks: 10 })),
      NOW,
    ).state;

    const recent = buildSummary(state, NOW).recent;

    expect(recent.length).toBeGreaterThan(1);
    expect(recent[0].at).toBeGreaterThanOrEqual(recent[1].at);
  });
});
