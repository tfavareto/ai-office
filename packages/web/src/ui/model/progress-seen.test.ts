import { describe, expect, test } from 'vitest';
import type { ProgressSummary } from '@ai-office/shared';
import { SEEN_KEY, announcements, loadSeen, parseSeen, saveSeen, seenFrom } from './progress-seen';

const summary = (over: Partial<ProgressSummary> = {}): ProgressSummary => ({
  level: 3,
  xp: 700,
  from: 500,
  to: 1200,
  achievements: 5,
  total: 22,
  recent: [{ id: 'tasks10', at: 5 }],
  ...over,
});

describe('announcements', () => {
  test('announces nothing the first time and takes the summary as the starting point', () => {
    const result = announcements(null, summary());

    expect(result).toMatchObject({ unlocked: [], count: 0 });
    expect(result.level).toBeUndefined();
    expect(result.next).toEqual(seenFrom(summary()));
  });

  test('announces a new unlock once', () => {
    const seen = seenFrom(summary());
    const later = summary({
      achievements: 6,
      recent: [
        { id: 'firstCommit', at: 9 },
        { id: 'tasks10', at: 5 },
      ],
    });

    const first = announcements(seen, later);
    const again = announcements(first.next, later);

    expect(first.unlocked).toEqual(['firstCommit']);
    expect(first.count).toBe(1);
    expect(again.unlocked).toEqual([]);
    expect(again.count).toBe(0);
  });

  test('counts unlocks the summary cannot name', () => {
    const seen = seenFrom(summary());

    expect(
      announcements(seen, summary({ achievements: 12, recent: seen.ids.map((id) => ({ id, at: 1 })) })).count,
    ).toBe(7);
  });

  test('announces a level up and never a lower level', () => {
    const seen = seenFrom(summary());

    expect(announcements(seen, summary({ level: 4 })).level).toBe(4);
    expect(announcements(seen, summary({ level: 2 })).level).toBeUndefined();
    expect(announcements(seen, summary({ level: 2 })).next.level).toBe(3);
  });
});

describe('seen storage', () => {
  test('round trips through a storage', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    };

    saveSeen(seenFrom(summary()), storage);

    expect(loadSeen(storage)).toEqual(seenFrom(summary()));
    expect(memory.has(SEEN_KEY)).toBe(true);
  });

  test.each([null, 'nope', '[]', '{"level":"x","count":1}', '{"level":2}'])(
    'treats %s as nothing announced',
    (text) => {
      expect(parseSeen(text)).toBeNull();
    },
  );

  test('drops unknown ids', () => {
    expect(parseSeen('{"level":2,"count":1,"ids":["tasks10","bogus",4]}')?.ids).toEqual(['tasks10']);
  });

  test('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(loadSeen(broken)).toBeNull();
    expect(() => saveSeen(seenFrom(summary()), broken)).not.toThrow();
  });
});
