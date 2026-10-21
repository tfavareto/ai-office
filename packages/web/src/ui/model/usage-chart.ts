// Geometry of the stacked token chart of the usage view. Pure: the component draws what this returns.
import type { UsageSeriesPoint } from '@ai-office/shared';

/** Token types, bottom to top of a stacked bar. */
export const STACK_ORDER = ['cacheRead', 'cacheWrite', 'input', 'output'] as const;
export type TokenKind = (typeof STACK_ORDER)[number];

export interface ChartSegment {
  kind: TokenKind;
  value: number;
  /** Top edge and height in chart pixels. */
  y: number;
  height: number;
}

export interface ChartBar {
  index: number;
  point: UsageSeriesPoint;
  x: number;
  width: number;
  /** Sum of the drawn token types. */
  total: number;
  segments: ChartSegment[];
  /** The bucket has not started yet. */
  future: boolean;
}

export interface ChartTick {
  value: number;
  y: number;
}

export interface ChartModel {
  width: number;
  height: number;
  plot: { left: number; top: number; width: number; height: number };
  bars: ChartBar[];
  ticks: ChartTick[];
  max: number;
  kinds: readonly TokenKind[];
  /** Nothing to draw: every bucket is empty. */
  empty: boolean;
}

export interface ChartOptions {
  width: number;
  height: number;
  includeCacheRead: boolean;
  margin?: { left: number; top: number; right: number; bottom: number };
}

export const DEFAULT_MARGIN = { left: 52, top: 10, right: 8, bottom: 26 } as const;
const TICK_COUNT = 4;
const BAR_FILL = 0.72;
const MIN_BAR_WIDTH = 2;
const MIN_SEGMENT_HEIGHT = 1;
const STEPS = [1, 2, 2.5, 5, 10] as const;

/** A round axis maximum at or above `value` split into `TICK_COUNT` equal steps (1, 2, 2.5, 5 times a power of ten). */
export function niceScale(value: number): { max: number; step: number } {
  if (!(value > 0)) return { max: TICK_COUNT, step: 1 };
  const raw = value / TICK_COUNT;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const factor = STEPS.find((candidate) => candidate * magnitude >= raw * (1 - 1e-9)) ?? 10;
  const step = factor * magnitude;
  return { max: step * TICK_COUNT, step };
}

function kindsFor(includeCacheRead: boolean): readonly TokenKind[] {
  return includeCacheRead ? STACK_ORDER : STACK_ORDER.filter((kind) => kind !== 'cacheRead');
}

function sumOf(point: UsageSeriesPoint, kinds: readonly TokenKind[]): number {
  return kinds.reduce((total, kind) => total + point[kind], 0);
}

export function buildChart(series: readonly UsageSeriesPoint[], now: number, options: ChartOptions): ChartModel {
  const margin = options.margin ?? DEFAULT_MARGIN;
  const plot = {
    left: margin.left,
    top: margin.top,
    width: Math.max(0, options.width - margin.left - margin.right),
    height: Math.max(0, options.height - margin.top - margin.bottom),
  };
  const kinds = kindsFor(options.includeCacheRead);
  const peak = series.reduce((highest, point) => Math.max(highest, sumOf(point, kinds)), 0);
  const { max, step } = niceScale(peak);
  const slot = series.length === 0 ? 0 : plot.width / series.length;
  const barWidth = Math.max(MIN_BAR_WIDTH, slot * BAR_FILL);
  const floor = plot.top + plot.height;
  const bars = series.map((point, index): ChartBar => {
    let top = floor;
    const segments: ChartSegment[] = [];
    for (const kind of kinds) {
      const value = point[kind];
      if (value <= 0) continue;
      const height = Math.max(MIN_SEGMENT_HEIGHT, (value / max) * plot.height);
      top -= height;
      segments.push({ kind, value, y: top, height });
    }
    return {
      index,
      point,
      x: plot.left + index * slot + (slot - barWidth) / 2,
      width: barWidth,
      total: sumOf(point, kinds),
      segments,
      future: point.start > now,
    };
  });
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i): ChartTick => ({
    value: i * step,
    y: floor - (i * step * plot.height) / max,
  }));
  return { width: options.width, height: options.height, plot, bars, ticks, max, kinds, empty: peak <= 0 };
}
