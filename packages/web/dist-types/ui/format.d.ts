/** Decimal with a comma and at most `digits` decimals, trailing zeros trimmed ("12,4"). */
export declare function formatDecimal(value: number, digits?: number): string;
/** "45 s", "12 min", "2 h 05 min", "1 d 3 h". */
export declare function formatDuration(ms: number): string;
/** Stopwatch style: "0:42", "12:03", "1:02:03". */
export declare function formatElapsed(ms: number): string;
/** "agora", "há 45 s", "há 3 min", "há 2 h", "há 3 d". */
export declare function formatAgo(ms: number): string;
/** "842", "12,4 mil", "1,23 mi". */
export declare function formatTokens(count: number): string;
/** "US$ 0,42"; unknown values render as an em dash. */
export declare function formatCost(usd: number | undefined): string;
export declare function formatClock(ts: number): string;
export declare function formatClockSeconds(ts: number): string;
/** Local calendar key, YYYY-MM-DD. */
export declare function toDateKey(ts: number): string;
/** Midnight (local) of the day containing `ts`. */
export declare function startOfDay(ts: number): number;
/** "Hoje", "Ontem" or "seg., 12/10". */
export declare function formatDayLabel(ts: number, now: number): string;
/** "25/10/2026" from a YYYY-MM-DD key. */
export declare function formatDateKey(key: string): string;
/** Moves a YYYY-MM-DD key by whole days (calendar arithmetic, DST safe). */
export declare function shiftDateKey(key: string, days: number): string;
export declare function pluralize(n: number, one: string, many: string): string;
export declare function formatCount(n: number, one: string, many: string): string;
/** "em 2 h 10 min" until `resetsAt`, or "agora" when already past. */
export declare function formatResetIn(resetsAt: number, now: number): string;
export declare function truncate(text: string, max: number): string;
/** Percentage 0-100, safe for zero denominators. */
export declare function percent(part: number, whole: number): number;
export declare function initials(name: string): string;
