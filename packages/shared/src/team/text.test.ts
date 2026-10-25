import { describe, expect, test } from 'vitest';
import { cleanLine, isSafeKey } from './text';

describe('cleanLine', () => {
  test('removes zero-width, bidi, tag and variation characters', () => {
    expect(cleanLine('a\u200Bb\u200Dc\u2060d', 20)).toBe('abcd');
    expect(cleanLine('x\u202Ey\u2066z\u2069', 20)).toBe('xyz');
    expect(cleanLine('t\u{E0041}\u{E0042}est', 20)).toBe('test');
    expect(cleanLine('v\uFE0Fw\u{E0100}x', 20)).toBe('vwx');
    expect(cleanLine('\uFEFFstart', 20)).toBe('start');
  });

  test('turns control and line-separator characters into a single space', () => {
    expect(cleanLine('a\u0000b\u0007c\n\r\td\u2028e\u2029f\u0085g', 20)).toBe('a b c d e f g');
  });

  test('normalizes to NFC', () => {
    expect(cleanLine('e\u0301', 5)).toBe('\u00e9');
  });

  test('cuts runs of combining marks (zalgo) to three', () => {
    const zalgo = `a${'\u0301\u0316\u0489\u0300\u0302\u0303\u0304'.repeat(6)}b`;
    const cleaned = cleanLine(zalgo, 50) ?? '';
    expect((cleaned.match(/\p{M}/gu) ?? []).length).toBeLessThanOrEqual(3);
    expect(cleaned.endsWith('b')).toBe(true);
  });

  test('caps by code points, collapses spaces, and refuses what is empty or not text', () => {
    expect(cleanLine('😀'.repeat(10), 3)).toBe('😀😀😀');
    expect(cleanLine('  a   b  ', 10)).toBe('a b');
    expect(cleanLine('\u200B\u200C', 10)).toBeUndefined();
    expect(cleanLine(5, 10)).toBeUndefined();
  });
});

describe('isSafeKey', () => {
  test('accepts plain keys and refuses special property names and odd characters', () => {
    expect(isSafeKey('a1B-_')).toBe(true);
    for (const bad of [
      '__proto__',
      'constructor',
      'prototype',
      'toString',
      'valueOf',
      'hasOwnProperty',
      '',
      'a b',
      'a.b',
      'x'.repeat(33),
      5,
      null,
    ])
      expect(isSafeKey(bad), String(bad)).toBe(false);
  });
});
