// View models of the usage dialog: KPI tiles, shares of the breakdown tables and the labels of sessions.
import { type UsageDetail, type UsageSessionRow, type UsageTotals, cacheHitShare } from '@ai-office/shared';

/** (current - previous) / previous, or undefined when there is nothing to compare with. */
export function relativeChange(current: number, previous: number): number | undefined {
  return previous > 0 ? (current - previous) / previous : undefined;
}

export interface Kpis {
  tokens: number;
  costUSD: number;
  tokensChange: number | undefined;
  costChange: number | undefined;
  /** Share of the input context served from the cache, 0..1. */
  cacheHit: number;
  hasData: boolean;
}

export function kpisOf(detail: Pick<UsageDetail, 'totals' | 'previous'>): Kpis {
  const { totals, previous } = detail;
  return {
    tokens: totals.tokens,
    costUSD: totals.costUSD,
    tokensChange: relativeChange(totals.tokens, previous.tokens),
    costChange: relativeChange(totals.costUSD, previous.costUSD),
    cacheHit: cacheHitShare(totals),
    hasData: totals.tokens > 0 || totals.cacheRead > 0 || totals.costUSD > 0,
  };
}

/** Share of `row` in `whole`, 0..1, by billable tokens. */
export function shareOf(row: Pick<UsageTotals, 'tokens'>, whole: Pick<UsageTotals, 'tokens'>): number {
  return whole.tokens <= 0 ? 0 : Math.min(1, row.tokens / whole.tokens);
}

const SHORT_ID_LENGTH = 8;

export interface SessionLabel {
  /** Title or description when the office knows it, else undefined (the caller falls back to the short id). */
  title: string | undefined;
  shortId: string;
  isSub: boolean;
}

export function sessionLabel(
  row: Pick<UsageSessionRow, 'session' | 'agent' | 'title'>,
  title: string | undefined,
): SessionLabel {
  const own = title ?? row.title;
  return {
    title: own !== undefined && own.trim().length > 0 ? own.trim() : undefined,
    shortId: (row.agent ?? row.session).slice(0, SHORT_ID_LENGTH),
    isSub: row.agent !== undefined,
  };
}

/** Accounts the picker offers: every account of the snapshot, in order, with "all" first when there is more than one. */
export function pickerAccounts(accountIds: readonly string[]): string[] {
  return accountIds.length > 1 ? ['all', ...accountIds] : [...accountIds];
}

/** The account to show after the list of accounts changed: keeps the choice when it still exists. */
export function resolveAccount(choice: string, accountIds: readonly string[]): string {
  const options = pickerAccounts(accountIds);
  if (options.includes(choice)) return choice;
  return options[0] ?? 'all';
}
