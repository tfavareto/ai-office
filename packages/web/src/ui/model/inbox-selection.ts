// Selection and cursor of the inbox list: multi-select with Shift+click ranges, and a cursor that survives items
// disappearing (decided, answered, expired).

export interface InboxSelection {
  ids: readonly string[];
  /** Last item toggled by the user: where a Shift+click range starts. */
  anchor: string | null;
}

export const EMPTY_SELECTION: InboxSelection = { ids: [], anchor: null };

export function isSelected(selection: InboxSelection, id: string): boolean {
  return selection.ids.includes(id);
}

export function toggleSelected(selection: InboxSelection, id: string): InboxSelection {
  const ids = isSelected(selection, id)
    ? selection.ids.filter((candidate) => candidate !== id)
    : [...selection.ids, id];
  return { ids, anchor: id };
}

/** Selects everything between the anchor and `id` (both included), keeping what was already selected. */
export function selectRange(selection: InboxSelection, ordered: readonly string[], id: string): InboxSelection {
  const to = ordered.indexOf(id);
  const from = selection.anchor === null ? -1 : ordered.indexOf(selection.anchor);
  if (to < 0) return selection;
  if (from < 0) return toggleSelected(selection, id);
  const [start, end] = from <= to ? [from, to] : [to, from];
  const merged = new Set([...selection.ids, ...ordered.slice(start, end + 1)]);
  return { ids: ordered.filter((candidate) => merged.has(candidate)), anchor: id };
}

export function selectAll(ordered: readonly string[]): InboxSelection {
  return { ids: [...ordered], anchor: ordered.length > 0 ? (ordered[ordered.length - 1] ?? null) : null };
}

/** Forgets selected items that are no longer in the list. */
export function pruneSelection(selection: InboxSelection, ordered: readonly string[]): InboxSelection {
  const present = new Set(ordered);
  const ids = selection.ids.filter((id) => present.has(id));
  if (ids.length === selection.ids.length && (selection.anchor === null || present.has(selection.anchor)))
    return selection;
  return { ids, anchor: selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null };
}

/** Moves the cursor by `delta` rows, stopping at the ends. Starts at the first row when there is no cursor. */
export function moveCursor(ordered: readonly string[], cursor: string | null, delta: number): string | null {
  if (ordered.length === 0) return null;
  const index = cursor === null ? -1 : ordered.indexOf(cursor);
  if (index < 0) return ordered[delta < 0 ? ordered.length - 1 : 0] ?? null;
  return ordered[Math.min(ordered.length - 1, Math.max(0, index + delta))] ?? null;
}

/**
 * Keeps the cursor on the same item when it is still there; otherwise on the row that took its place (so deciding
 * item after item keeps the cursor where the eyes are). The first row when there was no cursor.
 */
export function settleCursor(
  previous: readonly string[],
  next: readonly string[],
  cursor: string | null,
): string | null {
  if (next.length === 0) return null;
  if (cursor !== null && next.includes(cursor)) return cursor;
  const index = cursor === null ? 0 : Math.max(0, previous.indexOf(cursor));
  return next[Math.min(index, next.length - 1)] ?? null;
}
