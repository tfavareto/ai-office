// Plan usage per account, computed locally from transcript usage records (5 h window, week, today).
import type { AccountUsage } from '@ai-office/shared';
import { billableTokens, usageCostUSD } from '../claude/cost';
import type { UsageRecord } from '../claude/transcript-state';

const HOUR_MS = 3_600_000;
const WINDOW_MS = 5 * HOUR_MS;
const RETENTION_MS = 9 * 24 * HOUR_MS;
const PRUNE_EVERY = 2000;

interface Sample {
  at: number;
  tokens: number;
  costUSD: number;
}

/** Monday 00:00 local time of the week containing `at`. */
export function startOfWeek(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  const sinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - sinceMonday);
  return date.getTime();
}

export function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function nextWeekStart(weekStart: number): number {
  const date = new Date(weekStart);
  date.setDate(date.getDate() + 7);
  return date.getTime();
}

function floorToHour(at: number): number {
  return Math.floor(at / HOUR_MS) * HOUR_MS;
}

export class UsageTracker {
  private readonly samples = new Map<string, Map<string, Sample>>();
  private added = 0;

  /** Registers one assistant message; the same message id is only counted once (the latest numbers win). */
  add(accountId: string, scope: string, record: UsageRecord): void {
    const key = record.messageId === undefined ? `${scope}:${record.at}:${record.usage.output}` : record.messageId;
    let bucket = this.samples.get(accountId);
    if (bucket === undefined) {
      bucket = new Map();
      this.samples.set(accountId, bucket);
    }
    bucket.set(key, {
      at: record.at,
      tokens: billableTokens(record.usage),
      costUSD: usageCostUSD(record.model, record.usage) ?? 0,
    });
    if (++this.added % PRUNE_EVERY === 0) this.prune(record.at);
  }

  private prune(now: number): void {
    for (const bucket of this.samples.values()) {
      for (const [key, sample] of bucket) if (sample.at < now - RETENTION_MS) bucket.delete(key);
    }
  }

  compute(accountIds: readonly string[], now: number): AccountUsage[] {
    return accountIds.map((accountId) => this.computeFor(accountId, now));
  }

  private computeFor(accountId: string, now: number): AccountUsage {
    const samples = [...(this.samples.get(accountId)?.values() ?? [])].sort((a, b) => a.at - b.at);
    const weekStart = startOfWeek(now);
    const dayStart = startOfDay(now);
    const block = this.currentBlock(samples, now);
    const sum = (from: number): { tokens: number; costUSD: number } =>
      samples.filter((sample) => sample.at >= from && sample.at <= now).reduce((acc, sample) => ({ tokens: acc.tokens + sample.tokens, costUSD: acc.costUSD + sample.costUSD }), { tokens: 0, costUSD: 0 });
    return {
      accountId,
      window5h: { ...(block === undefined ? { tokens: 0, costUSD: 0 } : sum(block)), resetsAt: block === undefined ? now + WINDOW_MS : block + WINDOW_MS },
      week: { ...sum(weekStart), resetsAt: nextWeekStart(weekStart) },
      today: sum(dayStart),
    };
  }

  /** Start of the active 5 h block (blocks open at the first message after the previous one expired). */
  private currentBlock(samples: readonly Sample[], now: number): number | undefined {
    let blockStart: number | undefined;
    for (const sample of samples) {
      if (blockStart === undefined || sample.at >= blockStart + WINDOW_MS) blockStart = floorToHour(sample.at);
    }
    return blockStart !== undefined && now < blockStart + WINDOW_MS ? blockStart : undefined;
  }
}
