import { describe, expect, test } from 'vitest';
import { HireBook } from './hires';
import type { PendingHire } from './model';
import { HIRE_HANDOVER_MS, HIRE_WINDOW_MS } from './protocol';

const T0 = 1_800_000_000_000;

function hire(id: string, createdAt = T0): PendingHire {
  return { id, projectId: '/work/app', accountId: 'main', createdAt, expiresAt: createdAt + HIRE_WINDOW_MS };
}

describe('HireBook', () => {
  test('lists a waiting hire until its window ends', () => {
    const book = new HireBook();
    book.add(hire('h1'));

    expect(book.list(T0 + 1000).map((item) => item.id)).toEqual(['h1']);
    expect(book.list(T0 + HIRE_WINDOW_MS)).toEqual([]);
  });

  test('sweep returns hires that ran out of time and forgets them', () => {
    const book = new HireBook();
    book.add(hire('h1'));

    expect(book.sweep(T0 + 10)).toEqual([]);
    expect(book.sweep(T0 + HIRE_WINDOW_MS).map((item) => item.id)).toEqual(['h1']);
    expect(book.get('h1')).toBeUndefined();
  });

  test('a resolved hire carries the agent id for the handover period only', () => {
    const book = new HireBook();
    book.add(hire('h1'));

    expect(book.resolve('h1', 'main:abc', T0 + 5000)).toBe(true);

    expect(book.list(T0 + 6000)[0]?.agentId).toBe('main:abc');
    expect(book.list(T0 + 5000 + HIRE_HANDOVER_MS)).toEqual([]);
    expect(book.sweep(T0 + 5000 + HIRE_HANDOVER_MS)).toEqual([]);
    expect(book.get('h1')).toBeUndefined();
  });

  test('a hire resolves once and unknown ids are ignored', () => {
    const book = new HireBook();
    book.add(hire('h1'));

    expect(book.resolve('h1', 'a', T0)).toBe(true);
    expect(book.resolve('h1', 'b', T0)).toBe(false);
    expect(book.resolve('nope', 'b', T0)).toBe(false);
    expect(book.list(T0)[0]?.agentId).toBe('a');
  });

  test('unresolved excludes taken-over and expired hires', () => {
    const book = new HireBook();
    book.add(hire('waiting'));
    book.add(hire('taken'));
    book.add(hire('late', T0 - HIRE_WINDOW_MS - 1));
    book.resolve('taken', 'x', T0);

    expect(book.unresolved(T0).map((item) => item.id)).toEqual(['waiting']);
  });
});
