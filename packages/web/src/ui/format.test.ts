import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import {
  formatAgo,
  formatClock,
  formatClockSeconds,
  formatCost,
  formatDateKey,
  formatDayLabel,
  formatDecimal,
  formatDuration,
  formatElapsed,
  formatResetIn,
  formatTokens,
  initials,
  percent,
  shiftDateKey,
  truncate,
} from './format';

// The formatters follow the current interface language; everything below runs in pt-BR unless a block says otherwise.
beforeEach(() => setLocale('pt-BR'));
afterEach(() => setLocale('pt-BR'));

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
  it('truncates and builds initials', () => {
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

describe('formatting in English', () => {
  beforeEach(() => setLocale('en'));

  it('describes how long ago in English', () => {
    expect(formatAgo(3_000)).toBe('now');
    expect(formatAgo(45_000)).toBe('45 s ago');
    expect(formatAgo(3 * 60_000)).toBe('3 min ago');
    expect(formatAgo(2 * 3_600_000)).toBe('2 h ago');
    expect(formatAgo(3 * 86_400_000)).toBe('3 d ago');
  });

  it('formats tokens as compact numbers with a dot', () => {
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(12_400)).toBe('12.4K');
    expect(formatTokens(3_060_000)).toBe('3.06M');
  });

  it('formats cost with a dollar sign', () => {
    expect(formatCost(0.42)).toBe('$0.42');
    expect(formatCost(0.001)).toBe('< $0.01');
    expect(formatCost(250.4)).toBe('$250');
    expect(formatCost(undefined)).toBe('—');
  });

  it('formats decimals, dates and the time until a reset', () => {
    expect(formatDecimal(3.5, 2)).toBe('3.5');
    expect(formatDateKey('2026-10-19')).toBe('10/19/2026');
    expect(formatResetIn(10_000 + 2 * 3_600_000 + 10 * 60_000, 10_000)).toBe('in 2 h 10 min');
    expect(formatResetIn(5, 10)).toBe('now');
  });

  it('uses a 12-hour clock', () => {
    const afternoon = new Date(2026, 9, 19, 14, 5, 9).getTime();
    expect(formatClock(afternoon)).toBe('2:05 PM');
    expect(formatClockSeconds(afternoon)).toBe('2:05:09 PM');
  });

  it('labels today and yesterday', () => {
    const now = new Date(2026, 9, 19, 12).getTime();
    expect(formatDayLabel(now, now)).toBe('Today');
    expect(formatDayLabel(now - 86_400_000, now)).toBe('Yesterday');
  });
});

describe('formatting in Spanish', () => {
  beforeEach(() => setLocale('es'));

  it('describes how long ago in Spanish', () => {
    expect(formatAgo(3_000)).toBe('ahora');
    expect(formatAgo(3 * 60_000)).toBe('hace 3 min');
    expect(formatAgo(2 * 3_600_000)).toBe('hace 2 h');
  });

  it('formats tokens with a comma and a spaced suffix', () => {
    expect(formatTokens(12_400)).toBe('12,4 mil');
    expect(formatTokens(3_060_000)).toBe('3,06 M');
  });

  it('keeps the US$ prefix for cost', () => {
    expect(formatCost(0.42)).toBe('US$ 0,42');
    expect(formatCost(0.001)).toBe('< US$ 0,01');
  });

  it('uses a 24-hour clock and day-first dates', () => {
    const morning = new Date(2026, 9, 19, 9, 5, 9).getTime();
    expect(formatClock(morning)).toBe('09:05');
    expect(formatClockSeconds(morning)).toBe('09:05:09');
    expect(formatDateKey('2026-10-19')).toBe('19/10/2026');
    expect(formatResetIn(10_000 + 3_600_000, 10_000)).toBe('en 1 h 00 min');
  });

  it('labels today and yesterday', () => {
    const now = new Date(2026, 9, 19, 12).getTime();
    expect(formatDayLabel(now, now)).toBe('Hoy');
    expect(formatDayLabel(now - 86_400_000, now)).toBe('Ayer');
  });
});

describe('formatting in pt-BR (clock and dates)', () => {
  it('keeps the 24-hour clock with leading zeros and the weekday label', () => {
    const morning = new Date(2026, 9, 19, 9, 5, 9).getTime();
    expect(formatClock(morning)).toBe('09:05');
    expect(formatClockSeconds(morning)).toBe('09:05:09');
    const now = new Date(2026, 9, 19, 12).getTime();
    expect(formatDayLabel(now, now)).toBe('Hoje');
    expect(formatDayLabel(now - 86_400_000, now)).toBe('Ontem');
    expect(formatDayLabel(now - 3 * 86_400_000, now)).toBe('sex., 16/10');
  });
});
