// What the inbox remembers in this browser: which items the user has seen. Pure helpers plus (de)serialization;
// the data never leaves the page (localStorage only).

export const INBOX_STORAGE_KEY = 'ai-office:inbox';
const STATE_VERSION = 1;
/** Seen marks older than this are forgotten (their items are long gone). */
export const SEEN_MAX_AGE_MS = 3 * 24 * 3_600_000;
export const SEEN_MAX_ENTRIES = 300;

export interface InboxState {
  /**
   * Time of the first snapshot this browser saw. "Finished" items only exist for agents that became idle after it,
   * so a fresh browser does not start with a pile of old work. `null` until the first snapshot arrives.
   */
  baseline: number | null;
  /** Item id → when it was marked as seen. */
  seen: Readonly<Record<string, number>>;
}

export const EMPTY_INBOX_STATE: InboxState = { baseline: null, seen: {} };

export function isSeen(state: InboxState, id: string): boolean {
  return Object.hasOwn(state.seen, id);
}

/** Records the baseline once (the first time a snapshot is seen). */
export function withBaseline(state: InboxState, serverTime: number): InboxState {
  return state.baseline === null ? { ...state, baseline: serverTime } : state;
}

/** Marks items as seen; ids that are already seen keep their original time. */
export function markSeen(state: InboxState, ids: readonly string[], now: number): InboxState {
  const fresh = ids.filter((id) => !isSeen(state, id));
  if (fresh.length === 0) return state;
  return { ...state, seen: { ...state.seen, ...Object.fromEntries(fresh.map((id) => [id, now])) } };
}

/** Drops old marks and caps the list, newest marks win. */
export function pruneSeen(state: InboxState, now: number): InboxState {
  const kept = Object.entries(state.seen)
    .filter(([, at]) => now - at <= SEEN_MAX_AGE_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SEEN_MAX_ENTRIES);
  return kept.length === Object.keys(state.seen).length ? state : { ...state, seen: Object.fromEntries(kept) };
}

export function serializeInboxState(state: InboxState): string {
  return JSON.stringify({ v: STATE_VERSION, baseline: state.baseline, seen: state.seen });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validates unknown data (parsed JSON) into a state; anything malformed falls back to empty. */
export function parseInboxState(raw: unknown): InboxState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_INBOX_STATE;
  const data = raw as Record<string, unknown>;
  if (data.v !== STATE_VERSION) return EMPTY_INBOX_STATE;
  const seen: Record<string, number> = {};
  if (typeof data.seen === 'object' && data.seen !== null && !Array.isArray(data.seen)) {
    for (const [id, at] of Object.entries(data.seen)) if (isFiniteNumber(at)) seen[id] = at;
  }
  return { baseline: isFiniteNumber(data.baseline) ? data.baseline : null, seen };
}

export function parseInboxStateJson(text: string | null): InboxState {
  if (text === null) return EMPTY_INBOX_STATE;
  try {
    return parseInboxState(JSON.parse(text));
  } catch {
    return EMPTY_INBOX_STATE;
  }
}
