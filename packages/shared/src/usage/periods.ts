// Local calendar boundaries for the usage periods. Everything goes through Date's local-time constructor so a day
// that is 23 or 25 hours long (daylight saving time) still starts and ends at local midnight.
import type { UsagePeriod, UsageRange } from './types';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const WINDOW_MS = 5 * HOUR_MS;

/** Start of the UTC hour that contains `at`. */
export function floorToHour(at: number): number {
  return Math.floor(at / HOUR_MS) * HOUR_MS;
}

/** Local midnight of the day that contains `at`. */
export function startOfDay(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Local midnight `days` calendar days after the local midnight `dayStart`. */
export function addDays(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

/** Monday 00:00 local time of the week that contains `at`. */
export function startOfWeek(at: number): number {
  const day = startOfDay(at);
  const sinceMonday = (new Date(day).getDay() + 6) % 7;
  return addDays(day, -sinceMonday);
}

/** The first day of the local month that contains `at`, at 00:00. */
export function startOfMonth(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** The first day of the month `months` after the month that starts at `monthStart`. */
export function addMonths(monthStart: number, months: number): number {
  const date = new Date(monthStart);
  return new Date(date.getFullYear(), date.getMonth() + months, 1).getTime();
}

function boundsOf(period: UsagePeriod, at: number): { start: number; end: number; previousStart: number } {
  if (period === 'today') {
    const start = startOfDay(at);
    return { start, end: addDays(start, 1), previousStart: addDays(start, -1) };
  }
  if (period === 'week') {
    const start = startOfWeek(at);
    return { start, end: addDays(start, 7), previousStart: addDays(start, -7) };
  }
  const start = startOfMonth(at);
  return { start, end: addMonths(start, 1), previousStart: addMonths(start, -1) };
}

/**
 * The period that contains `now` and the slice of the previous period to compare it with: the same elapsed time
 * from the previous period's start, never beyond the end of that period (the 31st of a month against a 30-day month).
 */
export function periodRange(period: UsagePeriod, now: number): UsageRange {
  const { start, end, previousStart } = boundsOf(period, now);
  const previousEndFull = start;
  const elapsed = Math.max(HOUR_MS, now - start);
  return { start, end, previousStart, previousEnd: Math.min(previousEndFull, previousStart + elapsed) };
}

/** Start of the local week that follows the one that starts at `weekStart`. */
export function nextWeekStart(weekStart: number): number {
  return addDays(weekStart, 7);
}
