import { describe, expect, test } from 'vitest';
import { dayRange, localDateKey, reportDates, reportDayRange } from './range';

const NOON = new Date(2026, 9, 21, 12, 0).getTime();

describe('dayRange', () => {
  test('spans local midnight to local midnight', () => {
    const range = dayRange('2026-10-21');
    expect(range?.start).toBe(new Date(2026, 9, 21).getTime());
    expect(range?.end).toBe(new Date(2026, 9, 22).getTime());
  });

  test.each(['2026-02-30', '2026-13-01', '26-10-21', '2026-10-21x', '', '2026-1-1'])('rejects %s', (value) => {
    expect(dayRange(value)).toBeUndefined();
  });
});

describe('reportDayRange', () => {
  test('accepts today and the six previous days only', () => {
    expect(reportDayRange('2026-10-21', NOON)).toBeDefined();
    expect(reportDayRange('2026-10-15', NOON)).toBeDefined();
    expect(reportDayRange('2026-10-14', NOON)).toBeUndefined();
    expect(reportDayRange('2026-10-22', NOON)).toBeUndefined();
  });
});

describe('reportDates', () => {
  test('lists seven dates, today first', () => {
    const dates = reportDates(NOON);
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe(localDateKey(NOON));
    expect(dates[6]).toBe('2026-10-15');
  });
});
