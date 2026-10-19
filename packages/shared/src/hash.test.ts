import { describe, expect, test } from 'vitest';
import { fnv1a, mulberry32, pick, randInt } from './hash';

describe('fnv1a', () => {
  test('matches the published test vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
  });

  test('is stable and unsigned', () => {
    expect(fnv1a('/Users/demo/projeto')).toBe(fnv1a('/Users/demo/projeto'));
    expect(fnv1a('qualquer coisa')).toBeGreaterThanOrEqual(0);
  });
});

describe('mulberry32', () => {
  test('produces the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test('stays within [0, 1) and differs between seeds', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  test('pick and randInt respect their bounds', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      expect(['a', 'b', 'c']).toContain(pick(rng, ['a', 'b', 'c']));
      const n = randInt(rng, 5, 8);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(8);
    }
  });
});
