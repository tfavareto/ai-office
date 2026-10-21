// Plan windows computed from hourly totals: the open 5 h block, the week, today, and the highest completed blocks.
// A block opens at the hour of the first message after the previous block expired and lasts 5 hours.
import type { AccountUsage } from '../model';
import { HOUR_MS, WINDOW_MS, floorToHour, nextWeekStart, startOfDay, startOfWeek } from './periods';
import type { PeakFigure, UsageBurn, UsagePeaks, UsageWindowInfo } from './types';

export interface HourTotals {
  tokens: number;
  costUSD: number;
}

/** Totals per hour, keyed by the start of the UTC hour. */
export type HourMap = ReadonlyMap<number, HourTotals>;

export interface Block {
  start: number;
  tokens: number;
  costUSD: number;
}

/** How far back the open block is searched: a gap of 5 h without activity always starts a fresh block. */
const BLOCK_LOOKBACK_HOURS = 24 * 10;
/** The history the peaks look at: the last 90 days. */
export const PEAK_HISTORY_MS = 90 * 24 * HOUR_MS;

const ZERO: HourTotals = { tokens: 0, costUSD: 0 };

/** Sum of the hours that start in [from, to). */
export function sumHours(hours: HourMap, from: number, to: number): HourTotals {
  let tokens = 0;
  let costUSD = 0;
  for (let hour = Math.ceil(from / HOUR_MS) * HOUR_MS; hour < to; hour += HOUR_MS) {
    const found = hours.get(hour);
    if (found === undefined) continue;
    tokens += found.tokens;
    costUSD += found.costUSD;
  }
  return { tokens, costUSD };
}

/** Active hours (with any tokens) in [from, to), ascending. */
function activeHours(hours: HourMap, from: number, to: number): number[] {
  const result: number[] = [];
  for (let hour = Math.ceil(from / HOUR_MS) * HOUR_MS; hour < to; hour += HOUR_MS) {
    const found = hours.get(hour);
    if (found !== undefined && (found.tokens > 0 || found.costUSD > 0)) result.push(hour);
  }
  return result;
}

/** Splits ascending active hours into blocks. */
function chainBlocks(hours: HourMap, active: readonly number[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | undefined;
  for (const hour of active) {
    if (current === undefined || hour >= current.start + WINDOW_MS) {
      current = { start: hour, tokens: 0, costUSD: 0 };
      blocks.push(current);
    }
    const found = hours.get(hour) ?? ZERO;
    current.tokens += found.tokens;
    current.costUSD += found.costUSD;
  }
  return blocks;
}

/** The block that is open at `now`, if any. */
export function currentBlock(hours: HourMap, now: number): Block | undefined {
  const end = floorToHour(now) + HOUR_MS;
  const blocks = chainBlocks(hours, activeHours(hours, end - BLOCK_LOOKBACK_HOURS * HOUR_MS, end));
  const last = blocks[blocks.length - 1];
  return last !== undefined && now < last.start + WINDOW_MS ? last : undefined;
}

/** Hours with any activity in the local week that contains `now`. */
export function activeHoursInWeek(hours: HourMap, now: number): number {
  return activeHours(hours, startOfWeek(now), now + HOUR_MS).length;
}

function peakOf(items: readonly { tokens: number; costUSD: number }[]): PeakFigure {
  let tokens = 0;
  let costUSD = 0;
  for (const item of items) {
    tokens = Math.max(tokens, item.tokens);
    costUSD = Math.max(costUSD, item.costUSD);
  }
  return { tokens, costUSD, samples: items.length };
}

/** The highest completed 5 h block and the highest completed week of the last 90 days. */
export function computePeaks(hours: HourMap, now: number): UsagePeaks {
  const since = now - PEAK_HISTORY_MS;
  const sorted = [...hours.keys()].filter((hour) => hour >= since && hour <= now).sort((a, b) => a - b);
  const blocks = chainBlocks(hours, sorted).filter((block) => block.start + WINDOW_MS <= now);
  const weeks = new Map<number, Block>();
  for (const hour of sorted) {
    const start = startOfWeek(hour);
    if (nextWeekStart(start) > now) continue;
    const week = weeks.get(start) ?? { start, tokens: 0, costUSD: 0 };
    const found = hours.get(hour) ?? ZERO;
    weeks.set(start, { start, tokens: week.tokens + found.tokens, costUSD: week.costUSD + found.costUSD });
  }
  return { window5h: peakOf(blocks), week: peakOf([...weeks.values()]) };
}

/**
 * The figures the cards show for one account: open 5 h block, week from Monday 00:00 and today. `burn` and `peaks`
 * travel with them so the page can project the limits without asking the server again.
 */
export function computeAccountUsage(accountId: string, hours: HourMap, now: number, extras: { burn?: UsageBurn; peaks?: UsagePeaks } = {}): AccountUsage {
  const upTo = floorToHour(now) + HOUR_MS;
  const block = currentBlock(hours, now);
  const weekStart = startOfWeek(now);
  const blockTotals = block === undefined ? ZERO : { tokens: block.tokens, costUSD: block.costUSD };
  return {
    accountId,
    window5h: { ...blockTotals, resetsAt: block === undefined ? now + WINDOW_MS : block.start + WINDOW_MS },
    week: { ...sumHours(hours, weekStart, upTo), resetsAt: nextWeekStart(weekStart) },
    today: sumHours(hours, startOfDay(now), upTo),
    ...(extras.burn !== undefined ? { burn: extras.burn } : {}),
    ...(extras.peaks !== undefined ? { peaks: extras.peaks } : {}),
  };
}

/** The open block of an account as the detail view shows it. */
export function windowInfo(account: string, hours: HourMap, now: number): UsageWindowInfo {
  const block = currentBlock(hours, now);
  if (block === undefined) return { account, start: floorToHour(now), resetsAt: now + WINDOW_MS, tokens: 0, costUSD: 0, active: false };
  return { account, start: block.start, resetsAt: block.start + WINDOW_MS, tokens: block.tokens, costUSD: block.costUSD, active: true };
}
