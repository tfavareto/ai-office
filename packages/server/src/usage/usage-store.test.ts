import { describe, expect, test } from 'vitest';
import type { UsageRow } from '@ai-office/shared';
import { UsageStore, monthOf } from './usage-store';

const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 9, 19, 12);
const row = (over: Partial<UsageRow> = {}): UsageRow => ({ hour: BASE, account: 'a', project: '/p', model: 'm', session: 's', agent: '', input: 10, output: 20, cacheWrite: 30, cacheRead: 40, costUSD: 1, ...over });

describe('UsageStore', () => {
  test('adds into the same cell and keeps the hour totals of the account', () => {
    // Arrange
    const store = new UsageStore();
    // Act
    store.add(row());
    store.add(row({ input: 5 }));
    store.add(row({ session: 'other', input: 1, output: 1, cacheWrite: 1, cacheRead: 0, costUSD: 0.25 }));
    // Assert
    expect(store.size).toBe(2);
    expect(store.hoursOf('a').get(BASE)).toEqual({ tokens: 118, costUSD: 2.25 });
  });

  test('a negative delta corrects a cell and never leaves negative totals', () => {
    const store = new UsageStore();
    store.add(row());
    store.add(row({ input: -10, output: -20, cacheWrite: -30, cacheRead: -40, costUSD: -1 }));
    expect([...store.values()][0]).toMatchObject({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, costUSD: 0 });
    expect(store.hoursOf('a').get(BASE)).toEqual({ tokens: 0, costUSD: 0 });
  });

  test('ignores an empty delta', () => {
    const store = new UsageStore();
    store.add(row({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, costUSD: 0 }));
    expect(store.size).toBe(0);
    expect(store.version).toBe(0);
  });

  test('tracks the months that changed and counts rows per UTC month', () => {
    const store = new UsageStore();
    store.add(row());
    store.add(row({ hour: Date.UTC(2026, 8, 30, 23) }));
    expect(store.takeDirty().sort()).toEqual(['2026-09', '2026-10']);
    expect(store.takeDirty()).toEqual([]);
    expect(store.monthCounts()).toEqual(new Map([['2026-09', 1], ['2026-10', 1]]));
    expect(monthOf(BASE)).toBe('2026-10');
  });

  test('prunes rows and hour totals older than the cutoff', () => {
    const store = new UsageStore();
    store.add(row({ hour: BASE - 400 * 24 * HOUR }));
    store.add(row());
    const touched = store.prune(BASE - 100 * 24 * HOUR);
    expect(store.size).toBe(1);
    expect(touched).toHaveLength(1);
    expect(store.hoursOf('a').size).toBe(1);
    expect(store.takeDirty()).toContain(touched[0]);
  });
});
