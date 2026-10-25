import { describe, expect, it } from 'vitest';
import {
  CAPTURE_MARGIN,
  MAX_RENDER_SIDE,
  currentFraming,
  keepInside,
  overviewFraming,
  renderPlan,
} from './captureFraming';

const BUILDING = { width: 1400, height: 464 };

describe('renderPlan', () => {
  it('draws the art at a whole zoom when the picture needs more than 1', () => {
    const plan = renderPlan(1.54, { width: 2256, height: 760 });

    expect(plan.zoom).toBe(2);
    expect(plan.render.width).toBeCloseTo((2256 * 2) / 1.54, -1);
  });

  it('keeps an exact whole zoom as it is', () => {
    expect(renderPlan(2, { width: 1000, height: 500 })).toEqual({ zoom: 2, render: { width: 1000, height: 500 } });
  });

  it('draws at the fit itself when the picture needs less than 1', () => {
    const plan = renderPlan(0.62, { width: 1000, height: 400 });

    expect(plan.zoom).toBe(0.62);
    expect(plan.render).toEqual({ width: 1000, height: 400 });
  });

  it('never draws on a canvas bigger than the limit', () => {
    const plan = renderPlan(5.1, { width: 4096, height: 2000 });

    expect(Math.max(plan.render.width, plan.render.height)).toBeLessThanOrEqual(MAX_RENDER_SIDE);
    expect(plan.zoom).toBeGreaterThanOrEqual(5.1 - 1e-9);
  });
});

describe('overviewFraming', () => {
  it('centres the building and fits it with the margin on the tight side', () => {
    const f = overviewFraming(BUILDING, { width: 1120, height: 350 });

    expect(f.center).toEqual({ x: 700, y: 232 });
    expect(f.fit).toBeCloseTo(350 / (464 + CAPTURE_MARGIN * 2), 6);
  });

  it('fits by width when the picture is taller than the building', () => {
    const f = overviewFraming(BUILDING, { width: 984, height: 700 });

    expect(f.fit).toBeCloseTo(984 / (1400 + CAPTURE_MARGIN * 2), 6);
  });

  it('keeps the whole building inside the picture', () => {
    const out = { width: 1200, height: 630 };
    const f = overviewFraming(BUILDING, out);

    expect(BUILDING.width * f.fit).toBeLessThanOrEqual(out.width);
    expect(BUILDING.height * f.fit).toBeLessThanOrEqual(out.height);
  });

  it('draws bigger pictures at a whole zoom', () => {
    const f = overviewFraming(BUILDING, { width: 2256, height: 760 });

    expect(Number.isInteger(f.zoom)).toBe(true);
    expect(f.zoom).toBeGreaterThanOrEqual(f.fit);
  });
});

describe('currentFraming', () => {
  const live = { zoom: 2, center: { x: 300, y: 200 }, free: { width: 800, height: 600 } };

  it('shows the same region as the live view', () => {
    const f = currentFraming(live, { width: 400, height: 300 });

    expect(f.center).toEqual({ x: 300, y: 200 });
    expect(f.fit).toBeCloseTo(1, 6);
  });

  it('shows the whole live region when the picture has another aspect', () => {
    const out = { width: 1000, height: 200 };
    const f = currentFraming(live, out);

    expect(out.width / f.fit).toBeGreaterThanOrEqual(800 / 2 - 1e-6);
    expect(out.height / f.fit).toBeGreaterThanOrEqual(600 / 2 - 1e-6);
  });
});

describe('keepInside', () => {
  const world = { x: 0, y: 0, w: 2000, h: 1000 };

  it('moves a framing that would show past the edge', () => {
    const out = { width: 1000, height: 500 };
    const f = { ...overviewFraming(BUILDING, out), center: { x: 50, y: 20 }, fit: 1 };

    expect(keepInside(f, out, world)).toEqual({ x: 500, y: 250 });
  });

  it('centres a region bigger than the world', () => {
    const out = { width: 4000, height: 2000 };
    const f = { ...overviewFraming(BUILDING, out), center: { x: 10, y: 10 }, fit: 1 };

    expect(keepInside(f, out, world)).toEqual({ x: 1000, y: 500 });
  });

  it('leaves a framing alone when there is no world', () => {
    const f = overviewFraming(BUILDING, { width: 100, height: 100 });

    expect(keepInside(f, { width: 100, height: 100 }, null)).toEqual(f.center);
  });
});
