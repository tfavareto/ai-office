import { describe, expect, test } from 'vitest';
import { buildUsageDetail, hourMapsFromRows } from './aggregate';
import { HOUR_MS } from './periods';
import { type UsageRow, cacheHitShare } from './types';
import { useTimeZone } from './test-zone';

useTimeZone('America/New_York');

const local = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
const hourAt = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS;

function row(at: number, over: Partial<UsageRow> = {}): UsageRow {
  return { hour: hourAt(at), account: 'a', project: '/work/alpha', model: 'claude-sonnet-5-5', session: 's1', agent: '', input: 10, output: 20, cacheWrite: 30, cacheRead: 400, costUSD: 1, ...over };
}

function detail(rows: UsageRow[], now: number, period: 'today' | 'week' | 'month' = 'today', accounts = ['a']) {
  const maps = hourMapsFromRows(rows);
  return buildUsageDetail(rows, { accounts, label: accounts.length === 1 ? (accounts[0] as string) : 'all', period, now }, (account) => maps.get(account) ?? new Map());
}

describe('totals and breakdowns', () => {
  const now = local(2026, 10, 21, 15, 30);

  test('adds token types, counts billable tokens without cache reads and sums the cost', () => {
    // Arrange
    const rows = [row(now - HOUR_MS), row(now - 2 * HOUR_MS)];
    // Act
    const { totals } = detail(rows, now);
    // Assert
    expect(totals).toEqual({ input: 20, output: 40, cacheWrite: 60, cacheRead: 800, tokens: 120, costUSD: 2 });
    expect(cacheHitShare(totals)).toBeCloseTo(800 / (20 + 60 + 800));
  });

  test('groups by model, by project and by session or subagent, biggest first', () => {
    const rows = [
      row(now - HOUR_MS, { model: 'claude-opus-5-5', project: '/work/beta', session: 's2', output: 500 }),
      row(now - HOUR_MS),
      row(now - HOUR_MS, { agent: 'ag1', model: 'claude-haiku-4-5' }),
    ];
    const result = detail(rows, now);
    expect(result.byModel.map((m) => [m.model, m.family])).toEqual([
      ['claude-opus-5-5', 'opus'],
      ['claude-sonnet-5-5', 'sonnet'],
      ['claude-haiku-4-5', 'haiku'],
    ]);
    expect(result.byProject.map((p) => [p.project, p.name])).toEqual([
      ['/work/beta', 'beta'],
      ['/work/alpha', 'alpha'],
    ]);
    expect(result.sessionCount).toBe(3);
    expect(result.bySession[0]).toMatchObject({ session: 's2', projectName: 'beta' });
    expect(result.bySession.find((s) => s.agent === 'ag1')).toMatchObject({ session: 's1', agent: 'ag1' });
  });

  test('limits the session table and keeps the full count', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(now - HOUR_MS, { session: `s${i}`, output: i }));
    const result = detail(rows, now);
    expect(result.bySession).toHaveLength(12);
    expect(result.sessionCount).toBe(30);
  });

  test('only the queried accounts count and "all" adds them', () => {
    const rows = [row(now - HOUR_MS), row(now - HOUR_MS, { account: 'b', output: 100 })];
    expect(detail(rows, now, 'today', ['a']).totals.output).toBe(20);
    expect(detail(rows, now, 'today', ['a', 'b']).totals.output).toBe(120);
  });

  test('ignores rows outside the period', () => {
    const rows = [row(local(2026, 10, 20, 23, 0)), row(now - HOUR_MS)];
    expect(detail(rows, now).totals.tokens).toBe(60);
    expect(detail(rows, now, 'week').totals.tokens).toBe(120);
  });
});

describe('time series', () => {
  test('today has one bucket per hour of the local day, 25 on a day that gains an hour', () => {
    const now = local(2026, 11, 1, 12);
    const result = detail([row(now - HOUR_MS)], now);
    expect(result.granularity).toBe('hour');
    expect(result.series).toHaveLength(25);
    expect(result.series.reduce((sum, point) => sum + point.tokens, 0)).toBe(60);
  });

  test('the week has seven day buckets and a row belongs to its local day', () => {
    const now = local(2026, 10, 21, 12);
    // 23:30 local on Monday and 00:10 local on Tuesday are 40 minutes apart but on different days.
    const rows = [row(local(2026, 10, 19, 23, 30)), row(local(2026, 10, 20, 0, 10), { output: 80 })];
    const result = detail(rows, now, 'week');
    expect(result.granularity).toBe('day');
    expect(result.series).toHaveLength(7);
    expect(result.series[0]?.output).toBe(20);
    expect(result.series[1]?.output).toBe(80);
  });

  test('a day with 23 hours still falls into one bucket', () => {
    const now = local(2026, 3, 8, 22);
    const rows = [row(local(2026, 3, 8, 12))];
    const result = detail(rows, now, 'week');
    const sunday = result.series[6];
    expect(sunday?.end).toBe(local(2026, 3, 9));
    expect(sunday?.tokens).toBe(60);
  });

  test('the month has a bucket per day of the month', () => {
    expect(detail([], local(2026, 2, 10, 12), 'month').series).toHaveLength(28);
    expect(detail([], local(2026, 10, 10, 12), 'month').series).toHaveLength(31);
  });
});

describe('comparison and windows', () => {
  test('compares with the same elapsed time of the previous period', () => {
    const now = local(2026, 10, 21, 12);
    // Previous week slice: Monday 12 Oct 00:00 to Wednesday 14 Oct 12:00.
    const rows = [row(local(2026, 10, 13, 10)), row(local(2026, 10, 15, 10)), row(now - HOUR_MS)];
    const result = detail(rows, now, 'week');
    expect(result.previous.tokens).toBe(60);
    expect(result.totals.tokens).toBe(60);
  });

  test('reports the open 5 h window per account', () => {
    const now = local(2026, 10, 21, 15, 30);
    const rows = [row(now - HOUR_MS), row(now - HOUR_MS, { account: 'b' })];
    const result = detail(rows, now, 'today', ['a', 'b', 'c']);
    expect(result.windows.map((w) => [w.account, w.active, w.tokens])).toEqual([
      ['a', true, 60],
      ['b', true, 60],
      ['c', false, 0],
    ]);
    expect(result.windows[0]?.resetsAt).toBeGreaterThan(now);
  });

  test('carries the indexing progress', () => {
    const maps = hourMapsFromRows([]);
    const result = buildUsageDetail([], { accounts: ['a'], label: 'a', period: 'today', now: 1_000_000_000_000 }, (a) => maps.get(a) ?? new Map(), { state: 'indexing', percent: 42, filesDone: 3, filesTotal: 7 });
    expect(result.progress).toEqual({ state: 'indexing', percent: 42, filesDone: 3, filesTotal: 7 });
  });
});
