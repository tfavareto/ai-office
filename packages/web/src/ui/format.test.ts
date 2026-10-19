import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatCost,
  formatDateKey,
  formatDecimal,
  formatDuration,
  formatElapsed,
  formatResetIn,
  formatTokens,
  initials,
  percent,
  pluralize,
  shiftDateKey,
  truncate,
} from './format';

describe('formatDuration', () => {
  it('uses seconds, minutes, hours and days', () => {
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(125 * 60_000)).toBe('2 h 05 min');
    expect(formatDuration(27 * 3_600_000)).toBe('1 d 3 h');
  });

  it('clamps negative values to zero', () => {
    expect(formatDuration(-5)).toBe('0 s');
  });
});

describe('formatElapsed', () => {
  it('renders a stopwatch', () => {
    expect(formatElapsed(42_000)).toBe('0:42');
    expect(formatElapsed(12 * 60_000 + 3_000)).toBe('12:03');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
  });
});

describe('formatAgo', () => {
  it('describes how long ago in Portuguese', () => {
    expect(formatAgo(3_000)).toBe('agora');
    expect(formatAgo(45_000)).toBe('há 45 s');
    expect(formatAgo(3 * 60_000)).toBe('há 3 min');
    expect(formatAgo(2 * 3_600_000)).toBe('há 2 h');
    expect(formatAgo(3 * 86_400_000)).toBe('há 3 d');
  });
});

describe('number formatting', () => {
  it('formats tokens with comma decimals', () => {
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(12_400)).toBe('12,4 mil');
    expect(formatTokens(1_230_000)).toBe('1,23 mi');
  });

  it('formats cost and unknown cost', () => {
    expect(formatCost(0.42)).toBe('US$ 0,42');
    expect(formatCost(0.001)).toBe('< US$ 0,01');
    expect(formatCost(250.4)).toBe('US$ 250');
    expect(formatCost(undefined)).toBe('—');
  });

  it('trims trailing zeros in decimals', () => {
    expect(formatDecimal(3, 2)).toBe('3');
    expect(formatDecimal(3.5, 2)).toBe('3,5');
  });

  it('computes safe percentages', () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 0)).toBe(0);
    expect(percent(9, 3)).toBe(100);
  });
});

describe('text helpers', () => {
  it('pluralizes, truncates and builds initials', () => {
    expect(pluralize(1, 'sala', 'salas')).toBe('sala');
    expect(pluralize(2, 'sala', 'salas')).toBe('salas');
    expect(truncate('abcdefghij', 5)).toBe('abcd…');
    expect(initials('Ana Paula')).toBe('AP');
    expect(initials('bruno')).toBe('B');
    expect(initials('  ')).toBe('?');
  });
});

describe('dates', () => {
  it('shifts date keys across month boundaries', () => {
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('formats keys as dd/mm/yyyy', () => {
    expect(formatDateKey('2026-10-19')).toBe('19/10/2026');
  });

  it('describes the time until a reset', () => {
    expect(formatResetIn(10_000 + 2 * 3_600_000 + 10 * 60_000, 10_000)).toBe('em 2 h 10 min');
    expect(formatResetIn(5, 10)).toBe('agora');
  });
});
