// The conversation of one terminal on the canvas: pages from `/api/transcript` merged into a bounded list, and the
// small diff the DOM renderer needs. The first page is the newest entries (no `after`); the next pages continue from
// `next`. The server keeps `next` on the oldest tool call still waiting for its result and sends it again with the
// result, so a page can start with entries already held: those replace the old ones instead of being added twice.
import type { TranscriptEntry, TranscriptPage } from '@ai-office/shared';

/** Entries a terminal keeps in memory; older ones are dropped. */
export const MAX_KEPT_ENTRIES = 240;
/** Entries a canvas terminal puts in the DOM, and how many more "earlier" adds. */
export const WINDOW_ENTRIES = 40;
export const WINDOW_MAXIMIZED = 160;
/** Entries a resting terminal (not live) keeps in the DOM: enough to fill it. */
export const WINDOW_RECENT = 14;

export interface LiveTranscript {
  entries: readonly TranscriptEntry[];
  /** Where the next incremental fetch continues. */
  next: number;
  /** The session is still open (false once it ended). */
  open: boolean;
  /** At least one page arrived. */
  loaded: boolean;
}

export const EMPTY_LIVE: LiveTranscript = { entries: [], next: 0, open: true, loaded: false };

/** Identity of an entry across fetches: tools by their id, the rest by kind, time and size. */
export function entryKey(entry: TranscriptEntry): string {
  return entry.kind === 'tool' ? `tool:${entry.id}` : `${entry.kind}:${entry.at}:${entry.text.length}`;
}

function cap(entries: readonly TranscriptEntry[]): readonly TranscriptEntry[] {
  return entries.length > MAX_KEPT_ENTRIES ? entries.slice(entries.length - MAX_KEPT_ENTRIES) : entries;
}

/**
 * Applies a page. `requestedAfter` is the `after` it was fetched with (undefined for the first, newest page). A page
 * that does not continue where the state stopped (stale or out of order) is ignored.
 */
export function applyPage(
  state: LiveTranscript,
  page: TranscriptPage,
  requestedAfter: number | undefined,
): LiveTranscript {
  if (requestedAfter === undefined)
    return { entries: cap(page.entries), next: page.next, open: page.open, loaded: true };
  if (requestedAfter !== state.next) return state;
  if (page.entries.length === 0)
    return page.open === state.open && page.next === state.next
      ? state
      : { ...state, open: page.open, next: page.next };
  const first = page.entries[0] as TranscriptEntry;
  const key = entryKey(first);
  const searchFrom = Math.max(0, state.entries.length - page.entries.length - 1);
  let overlap = -1;
  for (let index = state.entries.length - 1; index >= searchFrom; index--) {
    if (entryKey(state.entries[index] as TranscriptEntry) === key) {
      overlap = index;
      break;
    }
  }
  const kept = overlap < 0 ? state.entries : state.entries.slice(0, overlap);
  return { entries: cap([...kept, ...page.entries]), next: page.next, open: page.open, loaded: true };
}

export interface RenderPlan {
  /** Rendered items to remove from the front. */
  dropFront: number;
  /** Rendered items that stay (after the front ones) because they are the same entries as the target's first ones. */
  keep: number;
  /** Entries to render after the kept ones. */
  append: readonly TranscriptEntry[];
}

/**
 * What to do to the DOM so it shows `target` (the entries that should be on screen) given what it shows now. Entries
 * are compared by identity: the merge above keeps the objects it did not change.
 */
export function planRender(rendered: readonly TranscriptEntry[], target: readonly TranscriptEntry[]): RenderPlan {
  const first = target[0];
  const start = first === undefined ? -1 : rendered.indexOf(first);
  if (start < 0) return { dropFront: rendered.length, keep: 0, append: target };
  let keep = 0;
  while (keep < target.length && rendered[start + keep] === target[keep]) keep++;
  return { dropFront: start, keep, append: target.slice(keep) };
}

/** The last `size` entries. */
export function windowOf(entries: readonly TranscriptEntry[], size: number): readonly TranscriptEntry[] {
  return entries.length > size ? entries.slice(entries.length - size) : entries;
}

/** The transcript a terminal already read, followed by the entries of `recent` that are newer than its last one. */
export function withNewer(
  read: readonly TranscriptEntry[],
  recent: readonly TranscriptEntry[],
): readonly TranscriptEntry[] {
  const last = read[read.length - 1];
  if (last === undefined) return recent;
  const newer = recent.filter((entry) => entry.at > last.at);
  return newer.length === 0 ? read : [...read, ...newer];
}
