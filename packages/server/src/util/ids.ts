import { randomBytes } from 'node:crypto';

/** Random hex id (URL safe). */
export function newId(bytes = 8): string {
  return randomBytes(bytes).toString('hex');
}

/** Safe single path segment for ids taken from query strings (session ids, agent ids, dates...). */
export function isSafeSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,160}$/.test(value) && value !== '.' && value !== '..';
}

/** Local date as YYYY-MM-DD. */
export function localDateString(at: number): string {
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export type Clock = () => number;
