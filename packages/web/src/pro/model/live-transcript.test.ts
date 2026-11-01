import type { TranscriptEntry } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { EMPTY_LIVE, MAX_KEPT_ENTRIES, applyPage, entryKey, planRender, windowOf, withNewer } from './live-transcript';

const user = (at: number, text = 'oi'): TranscriptEntry => ({ kind: 'user', at, text });
const assistant = (at: number, text = 'ok'): TranscriptEntry => ({ kind: 'assistant', at, text });
const tool = (id: string, at: number, result?: string): TranscriptEntry => ({
  kind: 'tool',
  at,
  id,
  name: 'Bash',
  summary: 'x',
  ...(result !== undefined ? { result } : {}),
});

describe('applyPage', () => {
  it('takes the first page as it comes', () => {
    const state = applyPage(EMPTY_LIVE, { entries: [user(1), assistant(2)], next: 2, open: true }, undefined);
    expect(state).toMatchObject({ next: 2, open: true, loaded: true });
    expect(state.entries).toHaveLength(2);
  });

  it('appends the page that continues where the state stopped', () => {
    const first = applyPage(EMPTY_LIVE, { entries: [user(1)], next: 1, open: true }, undefined);
    const second = applyPage(first, { entries: [assistant(2)], next: 2, open: true }, 1);
    expect(second.entries.map((entry) => entry.kind)).toEqual(['user', 'assistant']);
    expect(second.next).toBe(2);
  });

  it('ignores a stale or out-of-order page', () => {
    const first = applyPage(EMPTY_LIVE, { entries: [user(1)], next: 1, open: true }, undefined);
    expect(applyPage(first, { entries: [assistant(9)], next: 9, open: true }, 0)).toBe(first);
    expect(applyPage(first, { entries: [assistant(9)], next: 9, open: true }, 5)).toBe(first);
  });

  it('replaces a tool call that came back with its result instead of repeating it', () => {
    const first = applyPage(
      EMPTY_LIVE,
      { entries: [user(1), tool('t1', 2), assistant(3, 'waiting')], next: 1, open: true },
      undefined,
    );
    const done = tool('t1', 2, 'finished');
    const second = applyPage(
      first,
      { entries: [done, assistant(3, 'waiting'), assistant(4, 'more')], next: 4, open: true },
      1,
    );
    expect(second.entries.map(entryKey)).toEqual([
      entryKey(user(1)),
      'tool:t1',
      entryKey(assistant(3, 'waiting')),
      entryKey(assistant(4, 'more')),
    ]);
    expect(second.entries[1]).toBe(done);
  });

  it('only records that the session ended when the page has nothing new', () => {
    const first = applyPage(EMPTY_LIVE, { entries: [user(1)], next: 1, open: true }, undefined);
    expect(applyPage(first, { entries: [], next: 1, open: true }, 1)).toBe(first);
    const ended = applyPage(first, { entries: [], next: 1, open: false }, 1);
    expect(ended.open).toBe(false);
    expect(ended.entries).toBe(first.entries);
  });

  it('keeps only the newest entries', () => {
    const many = Array.from({ length: MAX_KEPT_ENTRIES + 50 }, (_, i) => assistant(i, `m${i}`));
    const state = applyPage(EMPTY_LIVE, { entries: many, next: many.length, open: true }, undefined);
    expect(state.entries).toHaveLength(MAX_KEPT_ENTRIES);
    expect(state.entries[state.entries.length - 1]).toBe(many[many.length - 1]);
    const more = applyPage(state, { entries: [assistant(9999)], next: many.length + 1, open: true }, many.length);
    expect(more.entries).toHaveLength(MAX_KEPT_ENTRIES);
  });
});

describe('planRender', () => {
  const entries = [user(1), assistant(2), assistant(3), assistant(4)];

  it('renders everything the first time', () => {
    expect(planRender([], entries)).toEqual({ dropFront: 0, keep: 0, append: entries });
  });

  it('appends only what is new', () => {
    const plan = planRender(entries.slice(0, 3), entries);
    expect(plan.keep).toBe(3);
    expect(plan.dropFront).toBe(0);
    expect(plan.append).toEqual([entries[3]]);
  });

  it('drops the front when the window moves forward', () => {
    const plan = planRender(entries.slice(0, 3), entries.slice(1));
    expect(plan.dropFront).toBe(1);
    expect(plan.keep).toBe(2);
    expect(plan.append).toEqual([entries[3]]);
  });

  it('re-renders from the first entry that changed', () => {
    const replaced = [...entries.slice(0, 2), assistant(3, 'edited'), entries[3] as TranscriptEntry];
    const plan = planRender(entries, replaced);
    expect(plan.keep).toBe(2);
    expect(plan.append).toEqual(replaced.slice(2));
  });

  it('starts over when nothing in common is left', () => {
    const plan = planRender(entries, [assistant(10)]);
    expect(plan).toEqual({ dropFront: 4, keep: 0, append: [assistant(10)] });
  });

  it('windows to the last entries', () => {
    expect(windowOf(entries, 2)).toEqual(entries.slice(2));
    expect(windowOf(entries, 10)).toBe(entries);
  });
});

describe('withNewer', () => {
  it('adds to what the terminal read only the activities that happened after it', () => {
    // Arrange
    const read: TranscriptEntry[] = [{ kind: 'user', at: 10, text: 'go' }];
    const recent: TranscriptEntry[] = [
      { kind: 'user', at: 5, text: 'old' },
      { kind: 'assistant', at: 20, text: 'new' },
    ];

    // Act
    const merged = withNewer(read, recent);

    // Assert
    expect(merged.map((entry) => entry.at)).toEqual([10, 20]);
    expect(withNewer(read, recent.slice(0, 1))).toBe(read);
    expect(withNewer([], recent)).toBe(recent);
  });
});
