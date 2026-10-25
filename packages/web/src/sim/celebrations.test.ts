import { describe, expect, it } from 'vitest';
import { CelebrationBook } from './celebrations';
import type { Trigger } from './triggers';

const trig = (agentId: string, kind: Trigger['kind'] = 'tasks-done', projectId = 'p'): Trigger => ({
  agentId,
  kind,
  projectId,
});

describe('celebration rationing', () => {
  it('grants the first celebration', () => {
    const book = new CelebrationBook();
    expect(book.request(trig('ana'), 10, false)).toMatchObject({ agentId: 'ana', kind: 'tasks-done', shower: false });
  });

  it('keeps a person from celebrating twice in a row, unless the second one matters more', () => {
    const book = new CelebrationBook();
    expect(book.request(trig('ana', 'commit'), 10, false)).not.toBeNull();
    expect(book.request(trig('ana', 'commit'), 12, false)).toBeNull();
    expect(book.request(trig('ana', 'tests-fixed'), 14, false)).not.toBeNull();
    expect(book.request(trig('ana', 'commit'), 20, false)).toBeNull();
    expect(book.request(trig('ana', 'pr-merged'), 24, false)).not.toBeNull();
  });

  it('lets the person celebrate again after the cooldown', () => {
    const book = new CelebrationBook();
    book.request(trig('ana'), 0, false);
    expect(book.request(trig('ana', 'streak-end'), 20, false)).toBeNull();
    expect(book.request(trig('ana', 'streak-end'), 40, false)).not.toBeNull();
  });

  it('spaces celebrations of different people', () => {
    const book = new CelebrationBook();
    expect(book.request(trig('ana'), 10, false)).not.toBeNull();
    expect(book.request(trig('bia'), 10.5, false)).toBeNull();
    expect(book.request(trig('bia'), 12, false)).not.toBeNull();
  });

  it('caps the celebrations inside a window', () => {
    const book = new CelebrationBook();
    let granted = 0;
    for (let i = 0; i < 10; i++) if (book.request(trig(`p${i}`), 10 + i * 1.7, false)) granted++;
    expect(granted).toBeLessThan(10);
    expect(granted).toBeGreaterThan(0);
  });

  it('grants a shower once per cooldown for a finished room', () => {
    const book = new CelebrationBook();
    expect(book.request(trig('ana'), 0, true)?.shower).toBe(true);
    expect(book.request(trig('bia', 'tasks-done'), 30, true)?.shower).toBe(false);
    expect(book.request(trig('caio', 'tasks-done'), 120, true)?.shower).toBe(true);
  });

  it('is more generous when lively and stingier when calm', () => {
    const calm = new CelebrationBook();
    calm.configure('calm');
    const lively = new CelebrationBook();
    lively.configure('lively');
    calm.request(trig('ana'), 0, false);
    lively.request(trig('ana'), 0, false);
    expect(calm.request(trig('ana', 'streak-end'), 20, false)).toBeNull();
    expect(lively.request(trig('ana', 'streak-end'), 20, false)).not.toBeNull();
  });

  it('forgets everything on reset', () => {
    const book = new CelebrationBook();
    book.request(trig('ana'), 0, false);
    book.reset();
    expect(book.request(trig('ana'), 1, false)).not.toBeNull();
  });
});
