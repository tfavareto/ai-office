import { describe, expect, test } from 'vitest';
import { buildUsageDetail, hourMapsFromRows } from '../usage/aggregate';
import { HOUR_MS, startOfWeek } from '../usage/periods';
import { demoAccountUsage, demoUsageRows } from './usage-history';

// Wednesday 14:20 local.
const NOW = new Date(2026, 9, 21, 14, 20).getTime();

describe('demo usage history', () => {
  test('is deterministic for the same moment', () => {
    expect(demoUsageRows(NOW)).toEqual(demoUsageRows(NOW));
  });

  test('covers several weeks for the demo accounts, Codex included, with several models and projects', () => {
    const rows = demoUsageRows(NOW);
    const first = Math.min(...rows.map((row) => row.hour));
    expect(NOW - first).toBeGreaterThan(8 * 7 * 24 * HOUR_MS);
    expect(new Set(rows.map((row) => row.account))).toEqual(new Set(['demo-pessoal', 'demo-trabalho', 'demo-codex']));
    expect(new Set(rows.map((row) => row.model)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((row) => row.project)).size).toBeGreaterThanOrEqual(4);
  });

  test('is quieter at night and on weekends than during the working day', () => {
    const rows = demoUsageRows(NOW).filter((row) => row.account === 'demo-trabalho' && row.hour < NOW - 24 * HOUR_MS);
    const share = (match: (date: Date) => boolean): number =>
      rows
        .filter((row) => match(new Date(row.hour)))
        .reduce((sum, row) => sum + row.input + row.output + row.cacheWrite, 0);
    expect(share((d) => d.getHours() >= 9 && d.getHours() <= 17 && d.getDay() >= 1 && d.getDay() <= 5)).toBeGreaterThan(
      share((d) => d.getHours() <= 5) * 20,
    );
    expect(share((d) => d.getDay() === 0 || d.getDay() === 6)).toBeLessThan(
      share((d) => d.getDay() >= 1 && d.getDay() <= 5) / 5,
    );
  });

  test('is working right now whatever the time of day', () => {
    const night = new Date(2026, 9, 21, 3, 10).getTime();
    const usage = demoAccountUsage(night, demoUsageRows(night));
    expect(usage.every((account) => account.window5h.tokens > 0)).toBe(true);
    expect(usage.every((account) => (account.burn?.tokens30m ?? 0) > 0)).toBe(true);
  });

  test('attributes today to the given sessions so the tables can link to people', () => {
    const rows = demoUsageRows(NOW, [
      { account: 'demo-pessoal', session: 'demo-session-demo-1', project: '/Users/demo/projetos/loja-online' },
    ]);
    const today = rows.filter((row) => row.account === 'demo-pessoal' && row.hour >= NOW - 3 * HOUR_MS);
    expect(today.some((row) => row.session === 'demo-session-demo-1')).toBe(true);
  });

  test('feeds the cards with windows, burn and peaks', () => {
    const usage = demoAccountUsage(NOW, demoUsageRows(NOW));
    const work = usage.find((account) => account.accountId === 'demo-trabalho');
    expect(work?.week.resetsAt).toBe(startOfWeek(NOW) + 7 * 24 * HOUR_MS);
    expect(work?.today.tokens).toBeGreaterThan(0);
    expect(work?.peaks?.window5h.samples).toBeGreaterThanOrEqual(3);
    expect(work?.peaks?.week.samples).toBeGreaterThanOrEqual(3);
  });

  test('the detail view and the cards agree on today and the week', () => {
    const rows = demoUsageRows(NOW);
    const maps = hourMapsFromRows(rows);
    const cards = demoAccountUsage(NOW, rows);
    for (const period of ['today', 'week'] as const) {
      const detail = buildUsageDetail(
        rows,
        { accounts: ['demo-trabalho'], label: 'demo-trabalho', period, now: NOW },
        (account) => maps.get(account) ?? new Map(),
      );
      const card = cards.find((account) => account.accountId === 'demo-trabalho');
      expect(detail.totals.tokens).toBe(period === 'today' ? card?.today.tokens : card?.week.tokens);
    }
  });
});
