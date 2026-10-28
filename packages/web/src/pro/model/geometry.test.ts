import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitCamera,
  lerpCamera,
  panBy,
  revealRect,
  screenToWorld,
  unionRects,
  visibleWorldRect,
  worldToScreen,
  zoomAt,
  rectsOverlap,
  type Area,
  type Camera,
} from './geometry';

const area: Area = { x: 0, y: 56, width: 1000, height: 600 };

describe('camera', () => {
  it('converts between world and screen and back', () => {
    const camera: Camera = { x: 120, y: -40, zoom: 0.5 };
    const world = screenToWorld(camera, { x: 620, y: 260 });
    expect(world).toEqual({ x: 1000, y: 600 });
    expect(worldToScreen(camera, world)).toEqual({ x: 620, y: 260 });
  });

  it('keeps the world point under the cursor still while zooming', () => {
    const camera: Camera = { x: 30, y: 10, zoom: 1 };
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(camera, anchor);
    const zoomed = zoomAt(camera, 1.6, anchor);
    expect(zoomed.zoom).toBeCloseTo(1.6);
    const after = screenToWorld(zoomed, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('never zooms past its limits', () => {
    const anchor = { x: 0, y: 0 };
    expect(zoomAt({ x: 0, y: 0, zoom: MAX_ZOOM }, 2, anchor).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, zoom: MIN_ZOOM }, 0.5, anchor).zoom).toBe(MIN_ZOOM);
  });

  it('pans by a screen delta', () => {
    expect(panBy({ x: 1, y: 2, zoom: 2 }, 10, -5)).toEqual({ x: 11, y: -3, zoom: 2 });
  });

  it('fits bounds inside the area, centered, without zooming in past the maximum asked', () => {
    const bounds = { x: 100, y: 100, width: 4000, height: 2000 };
    const camera = fitCamera(bounds, area, 40, 1);
    expect(camera.zoom).toBeCloseTo(920 / 4000);
    const topLeft = worldToScreen(camera, bounds);
    const bottomRight = worldToScreen(camera, { x: 4100, y: 2100 });
    expect(topLeft.x + bottomRight.x).toBeCloseTo(area.width);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(area.y + area.height / 2);
    expect(fitCamera({ x: 0, y: 0, width: 100, height: 100 }, area, 40, 1).zoom).toBe(1);
  });

  it('describes the visible part of the world, with a margin', () => {
    const rect = visibleWorldRect({ x: 0, y: 56, zoom: 0.5 }, area, 100);
    expect(rect).toEqual({ x: -100, y: -100, width: 2200, height: 1400 });
  });

  it('moves the camera only as much as needed to reveal a rectangle', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 1 };
    expect(revealRect(camera, { x: 100, y: 100, width: 200, height: 100 }, area)).toBe(camera);
    const moved = revealRect(camera, { x: 900, y: 100, width: 300, height: 100 }, area, 20);
    expect(moved.x).toBe(-220);
    expect(moved.y).toBe(0);
  });

  it('interpolates the zoom geometrically', () => {
    const middle = lerpCamera({ x: 0, y: 0, zoom: 0.25 }, { x: 100, y: 0, zoom: 1 }, 0.5);
    expect(middle.zoom).toBeCloseTo(0.5);
    expect(middle.x).toBe(50);
  });
});

describe('rectangles', () => {
  it('unites rectangles and detects overlaps', () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: -5, width: 5, height: 5 },
      ]),
    ).toEqual({
      x: 0,
      y: -5,
      width: 25,
      height: 15,
    });
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectsOverlap(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
    expect(rectsOverlap(a, { x: 9, y: 0, width: 5, height: 5 })).toBe(true);
    expect(rectsOverlap(a, { x: 12, y: 0, width: 5, height: 5 }, 5)).toBe(true);
  });
});
