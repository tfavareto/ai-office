// Builds the detailed usage view (totals, series, breakdowns, windows) from hourly rows. Pure: the server index and the
// demo history feed it the same way.
import { basename } from '../format';
import { HOUR_MS, addDays, periodRange } from './periods';
import { modelFamily } from './pricing';
import { rowTokens } from './types';
import type { UsageDetail, UsageModelRow, UsagePeriod, UsageProgress, UsageProjectRow, UsageRow, UsageSeriesPoint, UsageSessionRow, UsageTotals } from './types';
import { type HourMap, windowInfo } from './windows';

export const DEFAULT_SESSION_LIMIT = 12;
export const DEFAULT_PROJECT_LIMIT = 15;

export interface UsageQuery {
  /** Accounts to include (the caller expands "all"). */
  accounts: readonly string[];
  /** The value reported in `UsageDetail.account`: an account id or "all". */
  label: string;
  period: UsagePeriod;
  now: number;
  sessionLimit?: number;
  projectLimit?: number;
}

/** Mutable accumulator used while a query walks the rows (never escapes this module). */
interface Acc {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  tokens: number;
  costUSD: number;
}

const newAcc = (): Acc => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 0, costUSD: 0 });

function accumulate(acc: Acc, row: UsageRow): void {
  acc.input += row.input;
  acc.output += row.output;
  acc.cacheWrite += row.cacheWrite;
  acc.cacheRead += row.cacheRead;
  acc.tokens += rowTokens(row);
  acc.costUSD += row.costUSD;
}

const byBiggest = (a: Acc, b: Acc): number => b.tokens - a.tokens || b.costUSD - a.costUSD;

function totalsOf(acc: Acc): UsageTotals {
  return { input: acc.input, output: acc.output, cacheWrite: acc.cacheWrite, cacheRead: acc.cacheRead, tokens: acc.tokens, costUSD: acc.costUSD };
}

/** Start times of the buckets of the series: hours for "today", local days for "week" and "month". */
export function seriesBoundaries(period: UsagePeriod, start: number, end: number): number[] {
  const bounds: number[] = [];
  if (period === 'today') {
    for (let at = Math.ceil(start / HOUR_MS) * HOUR_MS; at < end; at += HOUR_MS) bounds.push(at);
    return bounds;
  }
  for (let at = start; at < end; at = addDays(at, 1)) bounds.push(at);
  return bounds;
}

/** Index of the bucket that holds `at` (the last boundary that is not after it), or -1 before the first. */
function bucketIndex(bounds: readonly number[], at: number): number {
  let low = 0;
  let high = bounds.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((bounds[middle] as number) <= at) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

interface SessionAcc extends Acc {
  account: string;
  session: string;
  agent: string;
  project: string;
  lastAt: number;
}

interface NamedAcc extends Acc {
  key: string;
}

function named(map: Map<string, NamedAcc>, key: string): NamedAcc {
  let found = map.get(key);
  if (found === undefined) {
    found = { ...newAcc(), key };
    map.set(key, found);
  }
  return found;
}

export function usageProjectName(project: string): string {
  return project === '' ? '' : basename(project);
}

const IDLE_PROGRESS: UsageProgress = { state: 'ready', percent: 100, filesDone: 0, filesTotal: 0 };

/**
 * Totals, series and breakdowns of `period` for the queried accounts, the comparable slice of the previous period and
 * the open 5 h window of each account. `hoursOf` supplies the per-hour totals of one account (all of its history).
 */
export function buildUsageDetail(rows: Iterable<UsageRow>, query: UsageQuery, hoursOf: (account: string) => HourMap, progress: UsageProgress = IDLE_PROGRESS): UsageDetail {
  const accounts = new Set(query.accounts);
  const range = periodRange(query.period, query.now);
  const bounds = seriesBoundaries(query.period, range.start, range.end);
  const series = bounds.map(() => newAcc());
  const total = newAcc();
  const previous = newAcc();
  const models = new Map<string, NamedAcc>();
  const projects = new Map<string, NamedAcc>();
  const sessions = new Map<string, SessionAcc>();
  const limit = query.now + HOUR_MS;

  for (const row of rows) {
    if (!accounts.has(row.account) || row.hour >= limit) continue;
    if (row.hour >= range.previousStart && row.hour < range.previousEnd) accumulate(previous, row);
    if (row.hour < range.start || row.hour >= range.end) continue;
    accumulate(total, row);
    const slot = bucketIndex(bounds, row.hour);
    if (slot >= 0) accumulate(series[slot] as Acc, row);
    accumulate(named(models, row.model), row);
    accumulate(named(projects, row.project), row);
    const key = `${row.account}\u0000${row.session}\u0000${row.agent}`;
    let session = sessions.get(key);
    if (session === undefined) {
      session = { ...newAcc(), account: row.account, session: row.session, agent: row.agent, project: row.project, lastAt: 0 };
      sessions.set(key, session);
    }
    accumulate(session, row);
    session.lastAt = Math.max(session.lastAt, row.hour);
    if (session.project === '') session.project = row.project;
  }

  return {
    account: query.label,
    period: query.period,
    generatedAt: query.now,
    range,
    granularity: query.period === 'today' ? 'hour' : 'day',
    totals: totalsOf(total),
    previous: totalsOf(previous),
    series: bounds.map((start, index): UsageSeriesPoint => ({ start, end: bounds[index + 1] ?? range.end, ...totalsOf(series[index] as Acc) })),
    byModel: [...models.values()].sort(byBiggest).map((acc): UsageModelRow => ({ model: acc.key, family: modelFamily(acc.key), ...totalsOf(acc) })),
    byProject: [...projects.values()]
      .sort(byBiggest)
      .slice(0, query.projectLimit ?? DEFAULT_PROJECT_LIMIT)
      .map((acc): UsageProjectRow => ({ project: acc.key, name: usageProjectName(acc.key), ...totalsOf(acc) })),
    bySession: [...sessions.values()]
      .sort(byBiggest)
      .slice(0, query.sessionLimit ?? DEFAULT_SESSION_LIMIT)
      .map(
        (acc): UsageSessionRow => ({
          account: acc.account,
          session: acc.session,
          ...(acc.agent !== '' ? { agent: acc.agent } : {}),
          project: acc.project,
          projectName: usageProjectName(acc.project),
          lastAt: acc.lastAt,
          ...totalsOf(acc),
        }),
      ),
    sessionCount: sessions.size,
    windows: query.accounts.map((account) => windowInfo(account, hoursOf(account), query.now)),
    progress,
  };
}

/** Hourly totals per account from rows (tests and the demo history; the server index maintains its own). */
export function hourMapsFromRows(rows: Iterable<UsageRow>): Map<string, Map<number, { tokens: number; costUSD: number }>> {
  const maps = new Map<string, Map<number, { tokens: number; costUSD: number }>>();
  for (const row of rows) {
    let hours = maps.get(row.account);
    if (hours === undefined) {
      hours = new Map();
      maps.set(row.account, hours);
    }
    const found = hours.get(row.hour);
    hours.set(row.hour, { tokens: (found?.tokens ?? 0) + rowTokens(row), costUSD: (found?.costUSD ?? 0) + row.costUSD });
  }
  return maps;
}
