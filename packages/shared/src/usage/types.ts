// Contract of the detailed usage view: hourly rows kept by the server index, the totals built from them and the
// response of GET /api/usage/detail. Every timestamp is epoch milliseconds.
import type { Msg } from '../i18n/i18n';
import type { ModelFamily } from './pricing';

export type UsagePeriod = 'today' | 'week' | 'month';
export const USAGE_PERIODS: readonly UsagePeriod[] = ['today', 'week', 'month'];

export function isUsagePeriod(value: unknown): value is UsagePeriod {
  return typeof value === 'string' && (USAGE_PERIODS as readonly string[]).includes(value);
}

/**
 * One cell of the usage history: what one session (or subagent) of one project spent on one model during one hour.
 * `hour` is the start of the UTC hour (epoch ms); local day, week and month boundaries are applied when querying.
 */
export interface UsageRow {
  hour: number;
  account: string;
  /** Working directory of the session ("" when unknown). */
  project: string;
  model: string;
  session: string;
  /** Subagent id; "" for the main transcript of the session. */
  agent: string;
  input: number;
  output: number;
  /** Cache writes of both lifetimes. */
  cacheWrite: number;
  cacheRead: number;
  /** Estimated with the price table at indexing time. */
  costUSD: number;
}

/** Token counters of a set of rows. `tokens` is what the cards count: input + output + cache writes (no cache reads). */
export interface UsageTotals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  tokens: number;
  costUSD: number;
}

export interface UsageSeriesPoint extends UsageTotals {
  start: number;
  end: number;
}

export interface UsageModelRow extends UsageTotals {
  model: string;
  family: ModelFamily;
}

export interface UsageProjectRow extends UsageTotals {
  /** Working directory (also the id of the room when the project is open in the office). */
  project: string;
  name: string;
}

export interface UsageSessionRow extends UsageTotals {
  account: string;
  session: string;
  /** Subagent id; absent for the main transcript. */
  agent?: string;
  project: string;
  projectName: string;
  /** Last hour with activity (start of that hour). */
  lastAt: number;
  /** Id of the person in the office, when the session is open there (the page selects it). */
  officeId?: string;
  /** Title or description, when the office knows the session. */
  title?: string;
  titleMsg?: Msg;
  /** Subagent type, when the office knows it. */
  role?: string;
  roleMsg?: Msg;
}

/** The 5 h window of one account at the moment of the request. */
export interface UsageWindowInfo {
  account: string;
  start: number;
  resetsAt: number;
  tokens: number;
  costUSD: number;
  /** A block is open (the window has activity and has not expired). */
  active: boolean;
}

export interface UsageProgress {
  state: 'indexing' | 'ready';
  /** 0..100, by bytes read. */
  percent: number;
  filesDone: number;
  filesTotal: number;
}

export interface UsageRange {
  start: number;
  /** Exclusive end of the period (in the future for an ongoing period). */
  end: number;
  /** The comparable slice of the previous period: same length as the part of this period that has elapsed. */
  previousStart: number;
  previousEnd: number;
}

export interface UsageDetail {
  /** An account id or "all". */
  account: string;
  period: UsagePeriod;
  generatedAt: number;
  range: UsageRange;
  /** Buckets of the time series: hours for "today", days for "week" and "month". */
  granularity: 'hour' | 'day';
  totals: UsageTotals;
  previous: UsageTotals;
  series: UsageSeriesPoint[];
  byModel: UsageModelRow[];
  byProject: UsageProjectRow[];
  /** Largest sessions and subagents first, at most `bySessionLimit`. */
  bySession: UsageSessionRow[];
  sessionCount: number;
  windows: UsageWindowInfo[];
  progress: UsageProgress;
  /** Numbers synthesized by demo mode. */
  demo?: boolean;
}

export function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, tokens: 0, costUSD: 0 };
}

/** Billable tokens of a row: what counts towards the plan figures (cache reads are not included). */
export function rowTokens(row: Pick<UsageRow, 'input' | 'output' | 'cacheWrite'>): number {
  return row.input + row.output + row.cacheWrite;
}

/** Share of the input context served from the cache: reads / (fresh input + writes + reads), 0..1. */
export function cacheHitShare(totals: UsageTotals): number {
  const context = totals.input + totals.cacheWrite + totals.cacheRead;
  return context <= 0 ? 0 : totals.cacheRead / context;
}

/** Recent consumption of an account, the input of the burn rate. */
export interface UsageBurn {
  tokens30m: number;
  costUSD30m: number;
  tokens60m: number;
  costUSD60m: number;
  /** Hours of the current week with any activity. */
  activeHoursWeek: number;
}

/** Highest completed 5 h block (or week) in the history, with how many completed ones there were. */
export interface PeakFigure {
  tokens: number;
  costUSD: number;
  samples: number;
}

export interface UsagePeaks {
  window5h: PeakFigure;
  week: PeakFigure;
}
