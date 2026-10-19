// Formatters for pt-BR text. Hand-rolled (no Intl) so output is identical in every runtime.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const WEEKDAYS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Decimal with a comma and at most `digits` decimals, trailing zeros trimmed ("12,4"). */
export function formatDecimal(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  const trimmed = digits > 0 && fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  return trimmed.replace('.', ',');
}

/** "45 s", "12 min", "2 h 05 min", "1 d 3 h". */
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

/** "agora", "há 45 s", "há 3 min", "há 2 h", "há 3 d". */
export function formatAgo(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 10 * SECOND) return 'agora';
  if (safe < MINUTE) return `há ${Math.floor(safe / SECOND)} s`;
  if (safe < HOUR) return `há ${Math.floor(safe / MINUTE)} min`;
  if (safe < DAY) return `há ${Math.floor(safe / HOUR)} h`;
  return `há ${Math.floor(safe / DAY)} d`;
}

/** "842", "12,4 mil", "1,23 mi". */
export function formatTokens(count: number): string {
  const n = Math.max(0, count);
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${formatDecimal(n / 1000, n < 10_000 ? 2 : 1)} mil`;
  return `${formatDecimal(n / 1_000_000, 2)} mi`;
}

/** "US$ 0,42"; unknown values render as an em dash. */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) return '—';
  if (usd > 0 && usd < 0.01) return '< US$ 0,01';
  if (usd >= 100) return `US$ ${Math.round(usd)}`;
  return `US$ ${usd.toFixed(2).replace('.', ',')}`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatClockSeconds(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
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

/** "Hoje", "Ontem" or "seg., 12/10". */
export function formatDayLabel(ts: number, now: number): string {
  const diffDays = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  const d = new Date(ts);
  return `${WEEKDAYS[d.getDay()]}, ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

/** "25/10/2026" from a YYYY-MM-DD key. */
export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-');
  return y && m && d ? `${d}/${m}/${y}` : key;
}

/** Moves a YYYY-MM-DD key by whole days (calendar arithmetic, DST safe). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, (d ?? 1) + days, 12);
  return toDateKey(date.getTime());
}

export function pluralize(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function formatCount(n: number, one: string, many: string): string {
  return `${n} ${pluralize(n, one, many)}`;
}

/** "em 2 h 10 min" until `resetsAt`, or "agora" when already past. */
export function formatResetIn(resetsAt: number, now: number): string {
  const left = resetsAt - now;
  return left <= 0 ? 'agora' : `em ${formatDuration(left)}`;
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
