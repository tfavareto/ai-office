import { describe, expect, test } from 'vitest';
import { ACHIEVEMENTS } from '@ai-office/shared';
import { parseProgress, parseProgressSummary } from './parse-progress';
import { parseSnapshot } from './parse';
import { snapshot } from '../test/fixtures';

describe('parseProgressSummary', () => {
  test('keeps a well-formed summary and derives the level from the xp', () => {
    const summary = parseProgressSummary({
      level: 99,
      xp: 5200,
      achievements: 12,
      recent: [{ id: 'tasks100', at: 5 }],
      employee: 'Ana',
    });

    expect(summary).toMatchObject({ level: 6, xp: 5200, from: 5000, to: 9000, achievements: 12, employee: 'Ana' });
    expect(summary?.recent).toEqual([{ id: 'tasks100', at: 5 }]);
    expect(summary?.total).toBe(ACHIEVEMENTS.length);
  });

  test.each([undefined, null, 'x', [], {}, { xp: 'many' }])('ignores %j', (value) => {
    expect(parseProgressSummary(value)).toBeUndefined();
  });

  test('drops unknown unlocks, caps the list and the name', () => {
    const summary = parseProgressSummary({
      xp: 1,
      recent: [{ id: 'nope', at: 1 }, ...Array.from({ length: 9 }, () => ({ id: 'tasks10', at: 2 }))],
      employee: 'x'.repeat(500),
    });

    expect(summary?.recent).toHaveLength(4);
    expect(summary?.employee).toHaveLength(80);
  });
});

describe('parseProgress', () => {
  test('shows every achievement of the catalog, locked when the server did not send it', () => {
    const progress = parseProgress({ level: { xp: 10 }, achievements: [{ id: 'tasks10', value: 4, unlockedAt: 9 }] });

    expect(progress.achievements).toHaveLength(ACHIEVEMENTS.length);
    expect(progress.achievements.find((a) => a.id === 'tasks10')).toMatchObject({
      value: 4,
      target: 10,
      unlockedAt: 9,
    });
    expect(progress.achievements.find((a) => a.id === 'tasks100')?.unlockedAt).toBeUndefined();
  });

  test('survives garbage', () => {
    const progress = parseProgress('garbage');

    expect(progress.level.level).toBe(1);
    expect(progress.stats.tasks).toBe(0);
    expect(progress.employee).toBeUndefined();
  });

  test('keeps the project of the employee only when it is there', () => {
    expect(parseProgress({ employee: { name: 'Ana', tasks: 3 } }).employee).toEqual({ name: 'Ana', tasks: 3 });
    expect(parseProgress({ employee: { name: 'Ana', tasks: 3, project: 'loja' } }).employee?.project).toBe('loja');
  });

  test('bounds absurd numbers and ignores a malformed date', () => {
    const progress = parseProgress({ stats: { tasks: -5, tokens: 1e30 }, since: '2026/10/01' });

    expect(progress.stats.tasks).toBe(0);
    expect(progress.stats.tokens).toBeLessThanOrEqual(1e13);
    expect(progress.since).toBeUndefined();
  });
});

describe('parseSnapshot', () => {
  test('carries the progress summary through', () => {
    const base = snapshot();
    const parsed = parseSnapshot(
      JSON.parse(JSON.stringify({ ...base, progress: { xp: 600, achievements: 3, recent: [] } })),
    );

    expect(parsed?.progress?.level).toBe(3);
  });

  test('has none when the server sent none', () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot())))?.progress).toBeUndefined();
  });
});
