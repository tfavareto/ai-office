import { describe, expect, test } from 'vitest';
import { HOUR_MS, startOfDay, startOfWeek } from './periods';
import { type HourMap, computeAccountUsage, computePeaks, currentBlock } from './windows';
import { useTimeZone } from './test-zone';

useTimeZone('America/Sao_Paulo');

const local = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
// Wednesday 15:30 local.
const NOW = local(2026, 10, 21, 15, 30);

function hoursOf(entries: readonly [number, number][]): HourMap {
  const map = new Map<number, { tokens: number; costUSD: number }>();
  for (const [hoursAgo, tokens] of entries) {
    const hour = Math.floor((NOW - hoursAgo * HOUR_MS) / HOUR_MS) * HOUR_MS;
    map.set(hour, { tokens, costUSD: tokens / 1000 });
  }
  return map;
}

describe('computeAccountUsage', () => {
  test('sums the open 5 h block, today and the week', () => {
    // Arrange
    const hours = hoursOf([
      [30, 100],
      [14, 200],
      [1, 300],
    ]);
    // Act
    const usage = computeAccountUsage('a', hours, NOW);
    // Assert
    expect(usage.window5h.tokens).toBe(300);
    expect(usage.today.tokens).toBe(500);
    expect(usage.week.tokens).toBe(600);
    expect(usage.week.resetsAt).toBe(startOfWeek(NOW) + 7 * 24 * HOUR_MS);
    expect(usage.today.costUSD).toBeCloseTo(0.5);
  });

  test('a block opens at the first hour after the previous one expired and lasts five hours', () => {
    const hours = hoursOf([
      [4, 10],
      [3, 20],
      [1, 40],
    ]);
    const block = currentBlock(hours, NOW);
    // All three hours fall within five hours of the first one.
    expect(block?.tokens).toBe(70);
    expect(block?.start).toBe(Math.floor((NOW - 4 * HOUR_MS) / HOUR_MS) * HOUR_MS);
  });

  test('a message more than five hours after the block start opens a new block', () => {
    const hours = hoursOf([
      [7, 100],
      [2, 50],
    ]);
    expect(currentBlock(hours, NOW)?.tokens).toBe(50);
  });

  test('an expired block leaves the window empty with a fresh reset time', () => {
    const usage = computeAccountUsage('a', hoursOf([[8, 100]]), NOW);
    expect(usage.window5h.tokens).toBe(0);
    expect(usage.window5h.resetsAt).toBe(NOW + 5 * HOUR_MS);
  });

  test('accounts without usage report zeros', () => {
    expect(computeAccountUsage('z', new Map(), NOW)).toMatchObject({
      accountId: 'z',
      today: { tokens: 0, costUSD: 0 },
      week: { tokens: 0 },
    });
  });

  test('today starts at local midnight', () => {
    const hours = hoursOf([[16, 500]]);
    const usage = computeAccountUsage('a', hours, NOW);
    expect(startOfDay(NOW)).toBeLessThan(NOW - 15 * HOUR_MS);
    expect(usage.today.tokens).toBe(0);
    expect(usage.week.tokens).toBe(500);
  });
});

describe('computePeaks', () => {
  test('finds the highest completed 5 h block and the highest completed week', () => {
    // Arrange: three separate blocks last week, one of them the biggest, plus an open block now.
    const hours = hoursOf([
      [24 * 8, 100],
      [24 * 8 - 1, 100],
      [24 * 6, 900],
      [24 * 5, 300],
      [1, 5000],
    ]);
    // Act
    const peaks = computePeaks(hours, NOW);
    // Assert
    expect(peaks.window5h.tokens).toBe(900);
    expect(peaks.window5h.samples).toBe(3);
    expect(peaks.week.samples).toBe(1);
    expect(peaks.week.tokens).toBeGreaterThanOrEqual(900);
  });

  test('ignores the block that is still open', () => {
    const peaks = computePeaks(hoursOf([[1, 700]]), NOW);
    expect(peaks.window5h.samples).toBe(0);
    expect(peaks.window5h.tokens).toBe(0);
  });
});
