// Text formatting helpers (pt-BR output).

/** Collapses whitespace runs (including newlines) into single spaces and trims. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** One-line truncation with a single ellipsis character; never longer than `max`. */
export function truncate(text: string, max: number): string {
  const flat = oneLine(text);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Last path segment ("/a/b/c.ts" -> "c.ts"); handles trailing slashes and Windows separators. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] as string) : path;
}

/** "42 s", "3 min 05 s", "1 h 20 min". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "950", "12,3 mil", "1,2 mi". */
export function formatTokens(count: number): string {
  const n = Math.max(0, count);
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace('.', ',')} mil`;
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
}
