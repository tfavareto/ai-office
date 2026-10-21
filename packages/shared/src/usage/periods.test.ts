import { describe, expect, test } from 'vitest';
import { HOUR_MS, addDays, addMonths, floorToHour, periodRange, startOfDay, startOfMonth, startOfWeek } from './periods';
import { useTimeZone } from './test-zone';

// A zone with daylight saving time: 2026-03-08 has 23 hours and 2026-11-01 has 25.
useTimeZone('America/New_York');

const local = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();

describe('local boundaries', () => {
  test('a day that gains an hour is 25 hours long', () => {
    // Arrange
    const noon = local(2026, 11, 1, 12);
    // Act
    const range = periodRange('today', noon);
    // Assert
    expect(range.start).toBe(local(2026, 11, 1));
    expect(range.end).toBe(local(2026, 11, 2));
    expect((range.end - range.start) / HOUR_MS).toBe(25);
  });

  test('a day that loses an hour is 23 hours long', () => {
    const range = periodRange('today', local(2026, 3, 8, 15));
    expect((range.end - range.start) / HOUR_MS).toBe(23);
  });

  test('the week starts on Monday at local midnight, also across a time change', () => {
    // Sunday 2026-03-08 is the day the clocks change; its week started on Monday the 2nd.
    const sunday = local(2026, 3, 8, 22);
    expect(startOfWeek(sunday)).toBe(local(2026, 3, 2));
    const range = periodRange('week', sunday);
    expect((range.end - range.start) / HOUR_MS).toBe(167);
    expect(range.end).toBe(local(2026, 3, 9));
  });

  test('Monday itself starts its own week and Sunday belongs to the previous Monday', () => {
    expect(startOfWeek(local(2026, 10, 19, 0, 30))).toBe(local(2026, 10, 19));
    expect(startOfWeek(local(2026, 10, 25, 23, 59))).toBe(local(2026, 10, 19));
  });

  test('the month is the calendar month', () => {
    const range = periodRange('month', local(2026, 10, 20, 10));
    expect(range.start).toBe(local(2026, 10, 1));
    expect(range.end).toBe(local(2026, 11, 1));
    expect(startOfMonth(local(2026, 2, 28, 23))).toBe(local(2026, 2, 1));
    expect(addMonths(local(2026, 12, 1), 1)).toBe(local(2027, 1, 1));
    expect(addMonths(local(2026, 1, 1), -1)).toBe(local(2025, 12, 1));
  });

  test('addDays keeps local midnight across the time change', () => {
    expect(addDays(local(2026, 3, 7), 2)).toBe(local(2026, 3, 9));
    expect(startOfDay(local(2026, 3, 9, 13))).toBe(local(2026, 3, 9));
  });
});

describe('comparison with the previous period', () => {
  test('compares the same elapsed time from the previous start', () => {
    // Wednesday 12:00: 2.5 days into the week.
    const now = local(2026, 10, 21, 12);
    const range = periodRange('week', now);
    expect(range.previousStart).toBe(local(2026, 10, 12));
    expect(range.previousEnd - range.previousStart).toBe(now - range.start);
  });

  test('never reaches past the end of a shorter previous month', () => {
    // 31 October compared with September (30 days).
    const range = periodRange('month', local(2026, 10, 31, 23));
    expect(range.previousStart).toBe(local(2026, 9, 1));
    expect(range.previousEnd).toBe(local(2026, 10, 1));
  });

  test('has at least one hour of comparison right after midnight', () => {
    const range = periodRange('today', local(2026, 10, 20, 0, 5));
    expect(range.previousEnd - range.previousStart).toBe(HOUR_MS);
  });
});

describe('floorToHour', () => {
  test('rounds down to the UTC hour', () => {
    expect(floorToHour(Date.UTC(2026, 9, 20, 13, 59, 59))).toBe(Date.UTC(2026, 9, 20, 13));
  });
});
