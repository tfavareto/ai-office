import { describe, expect, test } from 'vitest';
import { basename, formatDuration, formatTokens, oneLine, truncate } from './format';

describe('format', () => {
  test('oneLine collapses whitespace', () => {
    expect(oneLine('  a \n\n b\tc ')).toBe('a b c');
  });

  test('truncate never exceeds the limit and adds one ellipsis', () => {
    expect(truncate('curto', 10)).toBe('curto');
    const result = truncate('uma frase bem comprida para cortar', 12);
    expect(result.length).toBeLessThanOrEqual(12);
    expect(result.endsWith('…')).toBe(true);
  });

  test('basename handles posix, windows and trailing separators', () => {
    expect(basename('/a/b/c.ts')).toBe('c.ts');
    expect(basename('C:\\a\\b.txt')).toBe('b.txt');
    expect(basename('/a/b/')).toBe('b');
  });

  test('formatDuration in pt-BR units', () => {
    expect(formatDuration(42_000)).toBe('42 s');
    expect(formatDuration(185_000)).toBe('3 min 05 s');
    expect(formatDuration(4_800_000)).toBe('1 h 20 min');
    expect(formatDuration(-5)).toBe('0 s');
  });

  test('formatTokens uses a decimal comma', () => {
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(12_300)).toBe('12,3 mil');
    expect(formatTokens(1_200_000)).toBe('1,2 mi');
  });
});
