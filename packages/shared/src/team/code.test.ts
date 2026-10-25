import { describe, expect, test } from 'vitest';
import { PAIRING_ALPHABET, formatPairingCode, isValidPairingCode, normalizePairingCode } from './code';
import { isTeamId, memberColor } from './colors';

describe('pairing codes', () => {
  test('the alphabet has 32 distinct symbols and no look-alikes', () => {
    expect(new Set(PAIRING_ALPHABET).size).toBe(32);
    for (const bad of ['0', 'O', '1', 'I']) expect(PAIRING_ALPHABET).not.toContain(bad);
  });

  test('normalizes case, spaces and dashes; validates length and alphabet', () => {
    expect(normalizePairingCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(isValidPairingCode('ABCDEFGH')).toBe(true);
    expect(isValidPairingCode('ABCDEFG')).toBe(false);
    expect(isValidPairingCode('ABCDEFG0')).toBe(false);
    expect(formatPairingCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});

describe('member identity', () => {
  test('colors are stable per id and look like hex', () => {
    expect(memberColor('m1')).toBe(memberColor('m1'));
    expect(memberColor('m1')).toMatch(/^#[0-9a-f]{6}$/);
    expect(isTeamId('team:m1')).toBe(true);
    expect(isTeamId('/work/x')).toBe(false);
  });
});
