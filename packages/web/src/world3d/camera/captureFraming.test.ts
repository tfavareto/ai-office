import { describe, expect, it } from 'vitest';
import { CAPTURE_MARGIN_RATIO, currentIso, overviewIso } from './captureFraming';
import { freeRect, isoBasis, worldToScreen } from './isoCamera';

const BASIS = isoBasis();
const OFFICE = { min: { x: 0, y: -0.4, z: 0 }, max: { x: 66, y: 2.9, z: 21.75 } };

describe('overviewIso', () => {
  it('keeps every corner of the office inside the picture', () => {
    const out = { width: 2256, height: 760 };
    const iso = overviewIso(OFFICE, BASIS, out);
    const view = { ...out, insets: { top: 0, right: 0, bottom: 0, left: 0 } };

    for (const x of [OFFICE.min.x, OFFICE.max.x])
      for (const y of [OFFICE.min.y, OFFICE.max.y])
        for (const z of [OFFICE.min.z, OFFICE.max.z]) {
          const p = worldToScreen(iso, BASIS, view, { x, y, z });
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(out.width);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(out.height);
        }
  });

  it('leaves the margin on the tight side', () => {
    const out = { width: 1000, height: 1000 };
    const iso = overviewIso(OFFICE, BASIS, out);
    const view = { ...out, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
    const xs = [OFFICE.min.x, OFFICE.max.x].flatMap((x) =>
      [OFFICE.min.y, OFFICE.max.y].flatMap((y) =>
        [OFFICE.min.z, OFFICE.max.z].map((z) => worldToScreen(iso, BASIS, view, { x, y, z }).x),
      ),
    );

    expect(Math.min(...xs)).toBeCloseTo(Math.round(1000 * CAPTURE_MARGIN_RATIO), 0);
  });

  it('centres the office the same way whatever the picture size', () => {
    const small = overviewIso(OFFICE, BASIS, { width: 600, height: 400 });
    const big = overviewIso(OFFICE, BASIS, { width: 1200, height: 800 });

    expect(big.target.x).toBeCloseTo(small.target.x, 6);
    expect(big.target.z).toBeCloseTo(small.target.z, 6);
    expect(big.zoom).toBeCloseTo(small.zoom * 2, 4);
  });
});

describe('currentIso', () => {
  const live = { iso: { target: { x: 12, z: 5 }, zoom: 20 }, free: { width: 800, height: 600 } };

  it('keeps the point at the middle and the scale of the live view when the sizes match', () => {
    const iso = currentIso(live, { width: 800, height: 600 });

    expect(iso).toEqual(live.iso);
  });

  it('shows the whole free area in a picture with another aspect', () => {
    const out = { width: 1000, height: 250 };
    const iso = currentIso(live, out);
    const shownW = out.width / iso.zoom;
    const shownH = out.height / iso.zoom;

    expect(shownW).toBeGreaterThanOrEqual(800 / 20 - 1e-9);
    expect(shownH).toBeGreaterThanOrEqual(600 / 20 - 1e-9);
    expect(iso.target).toEqual(live.iso.target);
  });

  it('uses the free rectangle of a view with panels', () => {
    const view = { width: 1000, height: 600, insets: { top: 0, right: 200, bottom: 0, left: 0 } };

    expect(freeRect(view).w).toBe(800);
  });
});
