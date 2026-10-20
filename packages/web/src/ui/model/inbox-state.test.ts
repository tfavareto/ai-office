import { describe, expect, it } from 'vitest';
import {
  EMPTY_INBOX_STATE,
  SEEN_MAX_AGE_MS,
  SEEN_MAX_ENTRIES,
  isSeen,
  markSeen,
  parseInboxState,
  parseInboxStateJson,
  pruneSeen,
  serializeInboxState,
  withBaseline,
} from './inbox-state';

describe('inbox state', () => {
  it('records the baseline only once', () => {
    const first = withBaseline(EMPTY_INBOX_STATE, 500);
    expect(first.baseline).toBe(500);
    expect(withBaseline(first, 900)).toBe(first);
  });

  it('marks items as seen without changing the original state or the first seen time', () => {
    const once = markSeen(EMPTY_INBOX_STATE, ['a', 'b'], 100);
    const twice = markSeen(once, ['a', 'c'], 200);
    expect(EMPTY_INBOX_STATE.seen).toEqual({});
    expect(twice.seen).toEqual({ a: 100, b: 100, c: 200 });
    expect(isSeen(twice, 'b')).toBe(true);
    expect(isSeen(twice, 'z')).toBe(false);
  });

  it('returns the same state when there is nothing new to mark', () => {
    const state = markSeen(EMPTY_INBOX_STATE, ['a'], 1);
    expect(markSeen(state, ['a'], 2)).toBe(state);
    expect(markSeen(state, [], 2)).toBe(state);
  });

  it('is not fooled by ids that look like object internals', () => {
    expect(isSeen(EMPTY_INBOX_STATE, 'constructor')).toBe(false);
    expect(isSeen(EMPTY_INBOX_STATE, '__proto__')).toBe(false);
  });

  it('forgets old marks and caps the list keeping the newest', () => {
    const now = 10 * SEEN_MAX_AGE_MS;
    const old = { ...EMPTY_INBOX_STATE, seen: { old: now - SEEN_MAX_AGE_MS - 1, recent: now - 1 } };
    expect(pruneSeen(old, now).seen).toEqual({ recent: now - 1 });
    const many = { ...EMPTY_INBOX_STATE, seen: Object.fromEntries(Array.from({ length: SEEN_MAX_ENTRIES + 5 }, (_, i) => [`id${i}`, now - i])) };
    const pruned = pruneSeen(many, now);
    expect(Object.keys(pruned.seen)).toHaveLength(SEEN_MAX_ENTRIES);
    expect(isSeen(pruned, 'id0')).toBe(true);
    expect(isSeen(pruned, `id${SEEN_MAX_ENTRIES + 4}`)).toBe(false);
  });

  it('keeps the same state when nothing needs pruning', () => {
    const state = markSeen(EMPTY_INBOX_STATE, ['a'], 1_000);
    expect(pruneSeen(state, 2_000)).toBe(state);
  });

  it('survives a round trip through JSON', () => {
    const state = markSeen(withBaseline(EMPTY_INBOX_STATE, 42), ['a'], 7);
    expect(parseInboxStateJson(serializeInboxState(state))).toEqual(state);
  });

  it('falls back to empty on malformed or foreign data', () => {
    expect(parseInboxStateJson(null)).toEqual(EMPTY_INBOX_STATE);
    expect(parseInboxStateJson('{not json')).toEqual(EMPTY_INBOX_STATE);
    expect(parseInboxState([])).toEqual(EMPTY_INBOX_STATE);
    expect(parseInboxState({ v: 99, baseline: 1, seen: { a: 1 } })).toEqual(EMPTY_INBOX_STATE);
  });

  it('drops invalid fields one by one', () => {
    const parsed = parseInboxState({ v: 1, baseline: 'soon', seen: { ok: 5, bad: 'yes', worse: null, inf: Infinity } });
    expect(parsed).toEqual({ baseline: null, seen: { ok: 5 } });
  });
});
