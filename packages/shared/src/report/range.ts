// Which days a report can cover: today and the six days before it, in local time.
import { addDays, startOfDay } from '../usage/periods';
import { REPORT_DAYS } from './types';

export interface DayRange {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Local midnight that starts the day. */
  start: number;
  /** Local midnight that ends it (exclusive). */
  end: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local date of an instant, YYYY-MM-DD. */
export function localDateKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day a YYYY-MM-DD string names, or undefined when it is not a real calendar date. */
export function dayRange(date: string): DayRange | undefined {
  const match = DATE_PATTERN.exec(date);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const start = new Date(year, month - 1, day).getTime();
  const check = new Date(start);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return undefined;
  return { date, start, end: addDays(start, 1) };
}

/** The day, only when it is today or one of the previous {@link REPORT_DAYS} - 1 days. */
export function reportDayRange(date: string, now: number): DayRange | undefined {
  const range = dayRange(date);
  if (range === undefined) return undefined;
  const today = startOfDay(now);
  return range.start <= today && range.start >= addDays(today, -(REPORT_DAYS - 1)) ? range : undefined;
}

/** The dates the day picker offers, today first. */
export function reportDates(now: number): string[] {
  const today = startOfDay(now);
  return Array.from({ length: REPORT_DAYS }, (_, i) => localDateKey(addDays(today, -i)));
}
