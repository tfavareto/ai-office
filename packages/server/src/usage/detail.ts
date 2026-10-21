// Answers GET /api/usage/detail: the index (real accounts) and the synthesized history (demo accounts) feed the same
// aggregation; sessions the office knows get their title and a link to the person.
import {
  type Agent,
  DEMO_ACCOUNTS,
  type HourMap,
  type UsageDetail,
  type UsagePeriod,
  type UsageRow,
  buildUsageDetail,
  hourMapsFromRows,
  withOfficeSessions,
} from '@ai-office/shared';
import type { UsageIndexer } from './indexer';

export interface DetailRequest {
  /** Accounts to include: the caller expands "all" to the ids of the current accounts. */
  accountIds: readonly string[];
  /** The value reported as `account`: an id or "all". */
  label: string;
  period: UsagePeriod;
  now: number;
  /** Agents of the office, to name the sessions. */
  agents: readonly Agent[];
  /** Hourly history of the demo accounts, when demo mode is on. */
  demoRows?: readonly UsageRow[];
}

const DEMO_IDS: ReadonlySet<string> = new Set(DEMO_ACCOUNTS.map((account) => account.id));

function* chain<T>(...lists: Iterable<T>[]): Generator<T> {
  for (const list of lists) yield* list;
}

export function usageDetail(indexer: UsageIndexer, request: DetailRequest): UsageDetail {
  const demoRows = request.demoRows ?? [];
  const demoMaps = demoRows.length > 0 ? hourMapsFromRows(demoRows) : new Map<string, HourMap>();
  const hoursOf = (account: string): HourMap =>
    DEMO_IDS.has(account) ? (demoMaps.get(account) ?? new Map()) : indexer.hoursOf(account);
  const detail = buildUsageDetail(
    chain(indexer.rows(), demoRows),
    { accounts: request.accountIds, label: request.label, period: request.period, now: request.now },
    hoursOf,
    indexer.progress(),
  );
  const described = withOfficeSessions(detail, request.agents);
  return request.accountIds.some((id) => DEMO_IDS.has(id)) ? { ...described, demo: true } : described;
}
