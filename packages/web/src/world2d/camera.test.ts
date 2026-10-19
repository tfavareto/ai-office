import { describe, expect, it } from 'vitest';
import { Camera, fitContinuous, fitZoom, overviewZoom, stepLevel, zoomLevels } from './camera';

const view = { width: 1440, height: 900, insets: { top: 56, right: 380, bottom: 0, left: 320 } };

function cam(dpr = 2): Camera {
  const c = new Camera();
  c.dpr = dpr;
  c.view = view;
  return c;
}

describe('zoom levels', () => {
  it('keeps the device scale a whole number', () => {
    for (const dpr of [1, 2, 3]) {
      for (const z of zoomLevels(dpr).filter((l) => l !== 0.5)) expect(Number.isInteger(z * dpr)).toBe(true);
    }
  });

  it('offers integer zooms 1-6 on a 1x display and half steps on retina', () => {
    expect(zoomLevels(1)).toEqual([0.5, 1, 2, 3, 4, 5, 6]);
    expect(zoomLevels(2)).toContain(1.5);
  });
});

describe('camera math', () => {
  it('round-trips screen and world coordinates', () => {
    const c = cam();
    c.cx = 300;
    c.cy = 120;
    c.zoom = 3;
    const s = c.worldToScreen(412, 99);
    const w = c.screenToWorld(s.x, s.y);
    expect(w.x).toBeCloseTo(412);
    expect(w.y).toBeCloseTo(99);
  });

  it('anchors wheel zoom at the cursor', () => {
    const c = cam();
    c.zoom = 2;
    c.cx = 500;
    c.cy = 200;
    const before = c.screenToWorld(900, 400);
    c.zoomAt(1, 900, 400);
    expect(c.zoom).toBe(3);
    const after = c.screenToWorld(900, 400);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clamps zoom to the available range', () => {
    const c = cam();
    c.zoom = 6;
    c.zoomAt(1, 0, 0);
    expect(c.zoom).toBe(6);
    c.zoom = 0.5;
    c.zoomAt(-1, 0, 0);
    expect(c.zoom).toBe(0.5);
  });

  it('centres a focus point in the free area, not the full window', () => {
    const c = cam();
    c.zoom = 4;
    c.focus(640, 240, true);
    const s = c.worldToScreen(640, 240);
    expect(s.x).toBeCloseTo(320 + (1440 - 320 - 380) / 2);
    expect(s.y).toBeCloseTo(56 + (900 - 56) / 2);
  });

  it('fits the overview inside the insets with the largest fitting level', () => {
    const bounds = { x: 0, y: 0, w: 700, h: 400 };
    const z = fitZoom(bounds, view, zoomLevels(2));
    expect(z).toBe(1);
    const big = { x: 0, y: 0, w: 1400, h: 400 };
    expect(fitZoom(big, view, zoomLevels(2))).toBe(0.5);
  });

  it('eases toward its target and settles', () => {
    const c = cam();
    c.cx = 0;
    c.cy = 0;
    c.tx = 100;
    c.ty = 50;
    let moving = true;
    for (let i = 0; i < 200 && moving; i++) moving = c.update(1 / 60);
    expect(moving).toBe(false);
    expect(c.cx).toBe(100);
  });

  it('pans by screen delta and respects limits', () => {
    const c = cam();
    c.limits = { x: 0, y: 0, w: 100, h: 100 };
    c.cx = 50;
    c.cy = 50;
    c.zoom = 2;
    c.pan(-40, 0);
    expect(c.cx).toBe(70);
    c.pan(-4000, 0);
    expect(c.cx).toBe(100);
  });
});

describe('stepping from an arbitrary zoom', () => {
  const levels = zoomLevels(1);

  it('goes to the next level in or out of an in-between overview zoom', () => {
    expect(stepLevel(levels, 0.83, 1)).toBe(1);
    expect(stepLevel(levels, 0.83, -1)).toBe(0.5);
    expect(stepLevel(levels, 1.4, 1)).toBe(2);
  });

  it('skips a level that is almost the current zoom', () => {
    expect(stepLevel(levels, 0.98, 1)).toBe(2);
    expect(stepLevel(levels, 1.02, -1)).toBe(0.5);
  });

  it('stays put at both ends of the range', () => {
    expect(stepLevel(levels, 6, 1)).toBe(6);
    expect(stepLevel(levels, 0.4, -1)).toBe(0.4);
  });
});

describe('overview zoom', () => {
  const windowOf = (width: number, height: number, insets = { top: 56, right: 0, bottom: 56, left: 320 }) => ({ width, height, insets });
  /** 4 rooms: 62 x 29 tiles. */
  const building = { w: 62 * 16, h: 29 * 16 };

  function fits(zoom: number, view: ReturnType<typeof windowOf>): boolean {
    const freeW = view.width - view.insets.left - view.insets.right;
    const freeH = view.height - view.insets.top - view.insets.bottom;
    return building.w * zoom <= freeW && building.h * zoom <= freeH;
  }

  it('shows the whole building inside the insets at common sizes, at DPR 1 and 2', () => {
    for (const [w, h] of [[1280, 720], [1440, 900], [1920, 1080], [2560, 1440]]) {
      for (const dpr of [1, 2]) {
        const view = windowOf(w, h);
        const z = overviewZoom(building, view, dpr);
        expect(fits(z, view), `${w}x${h}@${dpr} zoom ${z}`).toBe(true);
      }
    }
  });

  it('fits with the drawer open too', () => {
    const view = windowOf(1440, 900, { top: 56, right: 380, bottom: 56, left: 320 });
    expect(fits(overviewZoom(building, view, 2), view)).toBe(true);
  });

  it('prefers a whole device-pixel scale when it wastes little', () => {
    const z = overviewZoom(building, windowOf(1440, 900), 2);
    expect(z).toBe(1);
    expect(Number.isInteger(z * 2)).toBe(true);
  });

  it('uses the exact fit when no crisp scale is close enough', () => {
    const view = windowOf(1280, 720);
    const z = overviewZoom(building, view, 1);
    expect(z).toBeLessThan(1);
    expect(z).toBeGreaterThanOrEqual(fitContinuous({ x: 0, y: 0, w: building.w + 128, h: building.h + 128 }, view, 12) - 1e-9);
  });

  it('never exceeds the maximum zoom for a tiny building on a huge window', () => {
    expect(overviewZoom({ w: 100, h: 80 }, windowOf(2560, 1440), 1)).toBeLessThanOrEqual(6);
  });
});

describe('animated framing', () => {
  it('eases the zoom to its target together with the centre', () => {
    const c = cam(1);
    c.zoom = 2;
    c.frame({ x: 400, y: 300 }, 0.75, false);
    expect(c.tz).toBe(0.75);
    let moving = true;
    for (let i = 0; i < 400 && moving; i++) moving = c.update(1 / 60);
    expect(moving).toBe(false);
    expect(c.zoom).toBe(0.75);
    expect(c.tz).toBeNull();
    const s = c.worldToScreen(400, 300);
    expect(s.x).toBeCloseTo(320 + (1440 - 320 - 380) / 2, 0);
  });

  it('applies the zoom at once when instant and when the user pans', () => {
    const c = cam(1);
    c.frame({ x: 0, y: 0 }, 1.5, true);
    expect(c.zoom).toBe(1.5);
    expect(c.tz).toBeNull();
    c.frame({ x: 0, y: 0 }, 3, false);
    c.pan(10, 0);
    expect(c.tz).toBeNull();
  });
});
