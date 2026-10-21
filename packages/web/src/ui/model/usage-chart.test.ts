import { describe, expect, it } from 'vitest';
import type { UsageSeriesPoint } from '@ai-office/shared';
import { buildChart, niceScale } from './usage-chart';

const HOUR = 3_600_000;
const point = (index: number, over: Partial<UsageSeriesPoint> = {}): UsageSeriesPoint => ({
  start: index * HOUR,
  end: (index + 1) * HOUR,
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  tokens: 0,
  costUSD: 0,
  ...over,
});

describe('niceScale', () => {
  it.each([
    [0, 4, 1],
    [1, 1, 0.25],
    [3.9, 4, 1],
    [4.1, 8, 2],
    [90, 100, 25],
    [1_230_000, 2_000_000, 500_000],
  ])('rounds %s up to a friendly axis of %s with steps of %s', (value, max, step) => {
    const scale = niceScale(value);
    expect(scale.max).toBe(max);
    expect(scale.step).toBe(step);
    expect(scale.max).toBeGreaterThanOrEqual(value);
  });
});

describe('buildChart', () => {
  const options = { width: 400, height: 200, includeCacheRead: false, margin: { left: 40, top: 10, right: 0, bottom: 20 } };

  it('stacks the token types from the bottom and scales to the tallest bar', () => {
    // Arrange
    const series = [point(0, { input: 100, output: 300, cacheWrite: 600 }), point(1, { input: 50 })];
    // Act
    const chart = buildChart(series, 10 * HOUR, options);
    // Assert
    const tall = chart.bars[0];
    expect(tall?.total).toBe(1000);
    expect(tall?.segments.map((segment) => segment.kind)).toEqual(['cacheWrite', 'input', 'output']);
    const floor = chart.plot.top + chart.plot.height;
    expect(tall?.segments[0]?.y).toBeCloseTo(floor - (tall?.segments[0]?.height ?? 0));
    const stacked = tall?.segments.reduce((sum, segment) => sum + segment.height, 0) ?? 0;
    expect(stacked).toBeCloseTo((1000 / chart.max) * chart.plot.height);
    expect(chart.ticks[0]).toMatchObject({ value: 0, y: floor });
    expect(chart.ticks.at(-1)?.value).toBe(chart.max);
  });

  it('leaves cache reads out unless asked, which changes the scale', () => {
    const series = [point(0, { output: 100, cacheRead: 9000 })];
    const without = buildChart(series, HOUR, options);
    const withReads = buildChart(series, HOUR, { ...options, includeCacheRead: true });
    expect(without.bars[0]?.segments.map((segment) => segment.kind)).toEqual(['output']);
    expect(withReads.bars[0]?.segments.map((segment) => segment.kind)).toEqual(['cacheRead', 'output']);
    expect(withReads.max).toBeGreaterThan(without.max);
  });

  it('keeps a tiny value visible', () => {
    const chart = buildChart([point(0, { output: 1 }), point(1, { output: 1_000_000 })], 3 * HOUR, options);
    expect(chart.bars[0]?.segments[0]?.height).toBeGreaterThanOrEqual(1);
  });

  it('lays the bars out evenly inside the plot', () => {
    const chart = buildChart([point(0), point(1), point(2), point(3)], HOUR, options);
    const xs = chart.bars.map((bar) => bar.x);
    expect(xs[0]).toBeGreaterThanOrEqual(chart.plot.left);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!);
    const last = chart.bars[3];
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(chart.plot.left + chart.plot.width);
  });

  it('marks the buckets that have not started yet', () => {
    const chart = buildChart([point(0), point(1), point(2)], 1.5 * HOUR, options);
    expect(chart.bars.map((bar) => bar.future)).toEqual([false, false, true]);
  });

  it('reports an empty chart', () => {
    expect(buildChart([point(0), point(1)], HOUR, options).empty).toBe(true);
    expect(buildChart([], HOUR, options).bars).toEqual([]);
    expect(buildChart([point(0, { output: 5 })], HOUR, options).empty).toBe(false);
  });
});
