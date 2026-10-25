import { EMPTY_TOTALS, type ReportTotals } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { MIN_STATS, selectStats } from './stats';

const day = (over: Partial<ReportTotals>): ReportTotals => ({
  ...EMPTY_TOTALS,
  agents: 4,
  activeMs: 3_600_000,
  ...over,
});
const ids = (totals: ReportTotals, showUsage = false): string[] => selectStats(totals, { showUsage }).map((s) => s.id);

describe('selectStats', () => {
  it('leads with agents and active time, then what the day produced', () => {
    expect(ids(day({ tasks: 23, commits: 9, testsPassed: 12 }))).toEqual([
      'agents',
      'time',
      'tasks',
      'commits',
      'tests',
    ]);
  });

  it('leaves out what did not happen', () => {
    expect(ids(day({ tasks: 3, commits: 0, testsPassed: 0 }))).toEqual(['agents', 'time', 'tasks']);
  });

  it('counts passed test runs, not failed ones', () => {
    const specs = selectStats(day({ testsPassed: 7, testsFailed: 2 }), { showUsage: false });

    expect(specs.find((s) => s.id === 'tests')?.value).toBe(7);
  });

  it('keeps tokens and cost off by default, even when something was spent', () => {
    expect(ids(day({ tasks: 1, tokens: 90_000, costUSD: 4.2 }))).not.toContain('tokens');
    expect(ids(day({ tasks: 1, tokens: 90_000, costUSD: 4.2 }))).not.toContain('cost');
  });

  it('adds tokens and cost last when asked to', () => {
    expect(ids(day({ tasks: 1, tokens: 90_000, costUSD: 4.2 }), true)).toEqual([
      'agents',
      'time',
      'tasks',
      'tokens',
      'cost',
    ]);
  });

  it('adds nothing about usage when nothing was spent', () => {
    expect(ids(day({ tasks: 1 }), true)).toEqual(['agents', 'time', 'tasks']);
  });

  it('fills a quiet day with the files count', () => {
    const quiet = ids(day({ files: 6 }));

    expect(quiet).toEqual(['agents', 'time', 'files']);
    expect(quiet.length).toBeGreaterThanOrEqual(MIN_STATS);
  });

  it('does not add the files count to a busy day', () => {
    expect(ids(day({ tasks: 2, files: 6 }))).not.toContain('files');
  });

  it('carries the raw numbers', () => {
    const specs = selectStats(day({ tasks: 5 }), { showUsage: false });

    expect(specs.find((s) => s.id === 'agents')?.value).toBe(4);
    expect(specs.find((s) => s.id === 'time')?.value).toBe(3_600_000);
  });
});
