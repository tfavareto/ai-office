// In-memory usage history: hourly rows (account x project x model x session x subagent) and per-account hour totals.
// Adding is additive, so a late revision of a message is a negative-and-positive delta, never a rewrite.
import { type HourMap, type HourTotals, type UsageRow, rowTokens } from '@ai-office/shared';

/** Month shard of an hour, in UTC (stable when the user changes time zone). */
export function monthOf(hour: number): string {
  return new Date(hour).toISOString().slice(0, 7);
}

function rowKey(row: Pick<UsageRow, 'hour' | 'account' | 'project' | 'model' | 'session' | 'agent'>): string {
  return `${row.hour}\u0000${row.account}\u0000${row.project}\u0000${row.model}\u0000${row.session}\u0000${row.agent}`;
}

const COST_DIGITS = 1e6;
const roundCost = (value: number): number => Math.round(value * COST_DIGITS) / COST_DIGITS;

export class UsageStore {
  private readonly rows = new Map<string, UsageRow>();
  private readonly hours = new Map<string, Map<number, HourTotals>>();
  private readonly dirty = new Set<string>();
  private changes = 0;

  /** Increases whenever the data changes (cache key for derived figures). */
  get version(): number {
    return this.changes;
  }

  get size(): number {
    return this.rows.size;
  }

  values(): IterableIterator<UsageRow> {
    return this.rows.values();
  }

  hoursOf(account: string): HourMap {
    return this.hours.get(account) ?? new Map();
  }

  /** Adds (or, with negative numbers, corrects) the usage of one cell. */
  add(delta: UsageRow): void {
    if (delta.input === 0 && delta.output === 0 && delta.cacheWrite === 0 && delta.cacheRead === 0 && delta.costUSD === 0) return;
    const key = rowKey(delta);
    const current = this.rows.get(key);
    const next: UsageRow = current === undefined
      ? { ...delta, costUSD: roundCost(delta.costUSD) }
      : {
          ...current,
          input: current.input + delta.input,
          output: current.output + delta.output,
          cacheWrite: current.cacheWrite + delta.cacheWrite,
          cacheRead: current.cacheRead + delta.cacheRead,
          costUSD: roundCost(current.costUSD + delta.costUSD),
        };
    this.rows.set(key, next);
    this.bumpHour(delta);
    this.dirty.add(monthOf(delta.hour));
    this.changes++;
  }

  private bumpHour(delta: UsageRow): void {
    let hours = this.hours.get(delta.account);
    if (hours === undefined) {
      hours = new Map();
      this.hours.set(delta.account, hours);
    }
    const found = hours.get(delta.hour);
    hours.set(delta.hour, { tokens: Math.max(0, (found?.tokens ?? 0) + rowTokens(delta)), costUSD: Math.max(0, roundCost((found?.costUSD ?? 0) + delta.costUSD)) });
  }

  /** Months changed since the last `takeDirty`. */
  takeDirty(): string[] {
    const months = [...this.dirty];
    this.dirty.clear();
    return months;
  }

  markDirty(months: readonly string[]): void {
    for (const month of months) this.dirty.add(month);
  }

  rowsOfMonth(month: string): UsageRow[] {
    const result: UsageRow[] = [];
    for (const row of this.rows.values()) if (monthOf(row.hour) === month) result.push(row);
    return result;
  }

  /** Row count of every month that has rows. */
  monthCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of this.rows.values()) counts.set(monthOf(row.hour), (counts.get(monthOf(row.hour)) ?? 0) + 1);
    return counts;
  }

  /** Forgets everything older than `cutoff` (epoch ms). Returns the months that lost rows. */
  prune(cutoff: number): string[] {
    const touched = new Set<string>();
    for (const [key, row] of this.rows) {
      if (row.hour >= cutoff) continue;
      this.rows.delete(key);
      touched.add(monthOf(row.hour));
    }
    for (const hours of this.hours.values()) for (const hour of hours.keys()) if (hour < cutoff) hours.delete(hour);
    if (touched.size > 0) this.changes++;
    this.markDirty([...touched]);
    return [...touched];
  }

  clear(): void {
    this.rows.clear();
    this.hours.clear();
    this.dirty.clear();
    this.changes++;
  }
}
