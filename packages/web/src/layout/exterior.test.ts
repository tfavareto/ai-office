import { describe, expect, it } from 'vitest';
import { BUILDING_H } from './constants';
import { WIDE_EXTERIOR_MARGINS, layoutExterior } from './exterior';

const intersectsBounds = (r: { x: number; y: number; w: number; h: number }, b: typeof r): boolean =>
  r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y;

describe('exterior layout', () => {
  it('uses the wide margins by default (the 3D city)', () => {
    const wide = layoutExterior(62);
    expect(wide.bounds).toEqual({ x: -34, y: -46, w: 62 + 68, h: BUILDING_H + 92 });
    expect(layoutExterior(62, WIDE_EXTERIOR_MARGINS)).toEqual(wide);
  });

  it('puts the world edges at the margins on each side', () => {
    const { bounds } = layoutExterior(62, { left: 40, right: 24, top: 20, bottom: 28 });
    expect(bounds).toEqual({ x: -40, y: -20, w: 62 + 64, h: BUILDING_H + 48 });
  });

  it('keeps the streets and the park inside the world, whatever the margins', () => {
    const layout = layoutExterior(62, { left: 16, right: 16, top: 16, bottom: 16 });
    for (const street of layout.streets) expect(intersectsBounds(street, layout.bounds)).toBe(true);
    const park = layout.grass[0];
    expect(park.x + park.w).toBe(layout.bounds.x + layout.bounds.w);
    expect(layout.bounds.y).toBeLessThanOrEqual(-12);
  });

  it('draws no rooftop that lies wholly outside the world', () => {
    for (const margins of [{ left: 16, right: 16, top: 16, bottom: 16 }, WIDE_EXTERIOR_MARGINS]) {
      const layout = layoutExterior(62, margins);
      for (const roof of layout.rooftops) expect(intersectsBounds(roof.rect, layout.bounds)).toBe(true);
    }
  });

  it('adds blocks of neighbours as the margin grows, and only appends', () => {
    const small = layoutExterior(62, { left: 24, right: 24, top: 24, bottom: 24 });
    const large = layoutExterior(62, { left: 64, right: 24, top: 48, bottom: 48 });
    expect(large.rooftops.length).toBeGreaterThan(small.rooftops.length);
    for (const roof of small.rooftops) expect(large.rooftops).toContainEqual(roof);
    const westmost = Math.min(...large.rooftops.map((r) => r.rect.x));
    expect(westmost).toBeLessThanOrEqual(-50);
  });
});
