import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  isSelected,
  moveCursor,
  pruneSelection,
  selectAll,
  selectRange,
  settleCursor,
  toggleSelected,
} from './inbox-selection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];

describe('selection', () => {
  it('toggles an item and remembers it as the anchor', () => {
    const on = toggleSelected(EMPTY_SELECTION, 'b');
    expect(on).toEqual({ ids: ['b'], anchor: 'b' });
    expect(isSelected(on, 'b')).toBe(true);
    expect(toggleSelected(on, 'b').ids).toEqual([]);
  });

  it('selects the range between the anchor and the clicked item, in list order', () => {
    const anchored = toggleSelected(EMPTY_SELECTION, 'b');
    expect(selectRange(anchored, ORDER, 'd').ids).toEqual(['b', 'c', 'd']);
    expect(selectRange(toggleSelected(EMPTY_SELECTION, 'd'), ORDER, 'b').ids).toEqual(['b', 'c', 'd']);
  });

  it('keeps what was selected outside the range', () => {
    const selection = selectRange(toggleSelected(toggleSelected(EMPTY_SELECTION, 'a'), 'c'), ORDER, 'e');
    expect(selection.ids).toEqual(['a', 'c', 'd', 'e']);
  });

  it('acts like a plain toggle when there is no anchor, and ignores unknown items', () => {
    expect(selectRange(EMPTY_SELECTION, ORDER, 'c').ids).toEqual(['c']);
    expect(selectRange(EMPTY_SELECTION, ORDER, 'zzz')).toBe(EMPTY_SELECTION);
  });

  it('selects everything', () => {
    expect(selectAll(ORDER).ids).toEqual(ORDER);
    expect(selectAll([])).toEqual(EMPTY_SELECTION);
  });

  it('forgets items that left the list', () => {
    const selection = { ids: ['a', 'x', 'c'], anchor: 'x' };
    expect(pruneSelection(selection, ORDER)).toEqual({ ids: ['a', 'c'], anchor: null });
    const same = { ids: ['a'], anchor: 'a' };
    expect(pruneSelection(same, ORDER)).toBe(same);
  });
});

describe('cursor', () => {
  it('moves by rows and stops at the ends', () => {
    expect(moveCursor(ORDER, 'b', 1)).toBe('c');
    expect(moveCursor(ORDER, 'b', -1)).toBe('a');
    expect(moveCursor(ORDER, 'a', -1)).toBe('a');
    expect(moveCursor(ORDER, 'e', 1)).toBe('e');
  });

  it('starts at the first row going down and the last going up when there is no cursor', () => {
    expect(moveCursor(ORDER, null, 1)).toBe('a');
    expect(moveCursor(ORDER, null, -1)).toBe('e');
    expect(moveCursor(ORDER, 'gone', 1)).toBe('a');
    expect(moveCursor([], 'a', 1)).toBeNull();
  });

  it('stays on the same item when it is still listed', () => {
    expect(settleCursor(ORDER, ['b', 'a', 'c'], 'c')).toBe('c');
  });

  it('moves to the row that took the place of a decided item', () => {
    expect(settleCursor(ORDER, ['a', 'c', 'd', 'e'], 'b')).toBe('c');
    expect(settleCursor(ORDER, ['a', 'b', 'c', 'd'], 'e')).toBe('d');
  });

  it('lands on the first row without a cursor, and nowhere when the list is empty', () => {
    expect(settleCursor([], ORDER, null)).toBe('a');
    expect(settleCursor(ORDER, [], 'b')).toBeNull();
  });
});
