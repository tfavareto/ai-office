// Locale-aware formatters. Numbers, dates and times go through Intl for the current interface language; the few
// words around them ("ago", "now", "today") come from the catalogs. Formatters are cached per locale.
import type { Locale } from '@ai-office/shared';
import { locale, t } from '../i18n';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Digits of a compact token count: "1,23 mil" below 10k, "12,3 mil" above. */
const TOKEN_FRACTION_SMALL = 2;
const TOKEN_FRACTION_LARGE = 1;
const TOKEN_SMALL_LIMIT = 10_000;
const COST_ROUND_FROM = 100;
const MIN_VISIBLE_COST = 0.01;

type CacheKey = `${Locale}|${string}`;
const numberFormats = new Map<CacheKey, Intl.NumberFormat>();
const dateFormats = new Map<CacheKey, Intl.DateTimeFormat>();

function numberFormat(id: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key: CacheKey = `${locale()}|${id}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale(), options);
    numberFormats.set(key, format);
  }
  return format;
}

function dateFormat(id: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key: CacheKey = `${locale()}|${id}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale(), options);
    dateFormats.set(key, format);
  }
  return format;
}

/** English clocks are 12-hour ("2:30 PM"); pt-BR and Spanish use 24 hours with a leading zero ("14:30"). */
function clockOptions(withSeconds: boolean): Intl.DateTimeFormatOptions {
  const base: Intl.DateTimeFormatOptions = withSeconds
    ? { minute: '2-digit', second: '2-digit' }
    : { minute: '2-digit' };
  return locale() === 'en'
    ? { ...base, hour: 'numeric', hour12: true }
    : { ...base, hour: '2-digit', hourCycle: 'h23' };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Decimal with the locale's separator and at most `digits` decimals, trailing zeros trimmed ("12,4" / "12.4"). */
export function formatDecimal(value: number, digits = 1): string {
  return numberFormat(`dec${digits}`, { maximumFractionDigits: digits }).format(value);
}

/** "45 s", "12 min", "2 h 05 min", "1 d 3 h" (unit symbols are the same in every supported language). */
export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  if (safe < MINUTE) return `${Math.floor(safe / SECOND)} s`;
  if (safe < HOUR) return `${Math.floor(safe / MINUTE)} min`;
  if (safe < DAY) {
    const hours = Math.floor(safe / HOUR);
    const minutes = Math.floor((safe % HOUR) / MINUTE);
    return `${hours} h ${pad2(minutes)} min`;
  }
  const days = Math.floor(safe / DAY);
  const hours = Math.floor((safe % DAY) / HOUR);
  return `${days} d ${hours} h`;
}

/** Stopwatch style: "0:42", "12:03", "1:02:03". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / SECOND));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

/** "agora" / "just now" / "ahora", then "há 45 s" / "45 s ago" / "hace 45 s", minutes, hours, days. */
export function formatAgo(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10 * SECOND) return t('time.now');
  if (safe < MINUTE) return t('time.ago', { value: `${Math.floor(safe / SECOND)} s` });
  if (safe < HOUR) return t('time.ago', { value: `${Math.floor(safe / MINUTE)} min` });
  if (safe < DAY) return t('time.ago', { value: `${Math.floor(safe / HOUR)} h` });
  return t('time.ago', { value: `${Math.floor(safe / DAY)} d` });
}

/** Compact token count: "842", "12,4 mil" / "12.4K" / "12,4 mil", "1,23 mi" / "1.23M" / "1,23 M". */
export function formatTokens(count: number): string {
  const n = Math.max(0, count);
  if (n < 1000) return String(Math.round(n));
  const fraction = n < TOKEN_SMALL_LIMIT || n >= 1_000_000 ? TOKEN_FRACTION_SMALL : TOKEN_FRACTION_LARGE;
  // Intl separates the number from its suffix with a no-break space; a regular one wraps like the rest of the text.
  return numberFormat(`tok${fraction}`, {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: fraction,
  })
    .format(n)
    .replace(/[\u00a0\u202f]/g, ' ');
}

/** Money is always US dollars: "US$ 0,42" in pt-BR and Spanish, "$0.42" in English; unknown values are an em dash. */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) return '—';
  const symbol = locale() === 'en' ? '$' : 'US$ ';
  if (usd > 0 && usd < MIN_VISIBLE_COST)
    return `< ${symbol}${numberFormat('cost2', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(MIN_VISIBLE_COST)}`;
  const amount =
    usd >= COST_ROUND_FROM
      ? numberFormat('cost0', { maximumFractionDigits: 0 }).format(usd)
      : numberFormat('cost2', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd);
  return `${symbol}${amount}`;
}

/** A whole number with the locale's grouping ("1.234.567" / "1,234,567"). */
export function formatInteger(value: number): string {
  return numberFormat('int', { maximumFractionDigits: 0 }).format(Math.round(value));
}

/** A signed relative change, "+12%" or "−5%" (a ratio of 0.12 is 12%); one decimal below 10%. */
export function formatChange(ratio: number): string {
  const digits = Math.abs(ratio) < 0.095 ? 1 : 0;
  return numberFormat(`chg${digits}`, {
    style: 'percent',
    signDisplay: 'exceptZero',
    maximumFractionDigits: digits,
  }).format(ratio);
}

/** A share, "42%" (a ratio of 0.42); below 1% it reads "< 1%". */
export function formatShare(ratio: number): string {
  if (ratio > 0 && ratio < 0.01)
    return `< ${numberFormat('shr', { style: 'percent', maximumFractionDigits: 0 }).format(0.01)}`;
  return numberFormat('shr', { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

/** "14h" in pt-BR/Spanish and "2 PM" in English: the label of an hour on a chart axis. */
export function formatHourLabel(ts: number): string {
  return locale() === 'en'
    ? dateFormat('hour-en', { hour: 'numeric', hour12: true }).format(ts)
    : `${pad2(new Date(ts).getHours())}h`;
}

/** Short weekday and day of the month, "ter. 21" / "Tue 21". */
export function formatDayShort(ts: number): string {
  return dateFormat('day-short', { weekday: 'short', day: 'numeric' })
    .format(ts)
    .replace(/,/g, '')
    .replace(/[\u00a0\u202f]/g, ' ');
}

/** Day of the month, "21". */
export function formatDayNumber(ts: number): string {
  return String(new Date(ts).getDate());
}

/** Weekday, day and month in full, "terça-feira, 21 de outubro". */
export function formatDateLong(ts: number): string {
  return dateFormat('date-long', { weekday: 'long', day: 'numeric', month: 'long' }).format(ts);
}

/** A moment on a chart or forecast: the clock when it is today, otherwise short weekday and clock ("sex. 14:30"). */
export function formatMoment(ts: number, now: number): string {
  if (startOfDay(ts) === startOfDay(now)) return formatClock(ts);
  return `${dateFormat('weekday-short', { weekday: 'short' })
    .format(ts)
    .replace(/[\u00a0\u202f]/g, ' ')} ${formatClock(ts)}`;
}

/** "14:30" in pt-BR/Spanish, "2:30 PM" in English. */
export function formatClock(ts: number): string {
  return dateFormat('clock', clockOptions(false)).format(ts);
}

export function formatClockSeconds(ts: number): string {
  return dateFormat('clock-s', clockOptions(true)).format(ts);
}

/** Local calendar key, YYYY-MM-DD. */
export function toDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Midnight (local) of the day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Hoje" / "Today" / "Hoy", "Ontem" / "Yesterday" / "Ayer", or a short weekday and date ("seg., 12/10"). */
export function formatDayLabel(ts: number, now: number): string {
  const diffDays = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (diffDays === 0) return t('time.today');
  if (diffDays === 1) return t('time.yesterday');
  return dateFormat('weekday', { weekday: 'short', day: '2-digit', month: '2-digit' }).format(ts);
}

/** A YYYY-MM-DD key in the locale's order: "25/10/2026" (pt-BR, Spanish) or "10/25/2026" (English). */
export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return dateFormat('date', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(y, m - 1, d, 12));
}

/** A YYYY-MM-DD key written out: "25 de outubro de 2026" / "October 25, 2026" / "25 de octubre de 2026". */
export function formatDateKeyLong(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return dateFormat('date-full', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(y, m - 1, d, 12));
}

/** Moves a YYYY-MM-DD key by whole days (calendar arithmetic, DST safe). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + days, 12);
  return toDateKey(date.getTime());
}

/** "em 2 h 10 min" / "in 2 h 10 min" until `resetsAt`, or "agora" / "now" when already past. */
export function formatResetIn(resetsAt: number, now: number): string {
  const left = resetsAt - now;
  return left <= 0 ? t('time.now') : t('time.in', { value: formatDuration(left) });
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Percentage 0-100, safe for zero denominators. */
export function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.max(0, Math.min(100, (part / whole) * 100));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase();
}
