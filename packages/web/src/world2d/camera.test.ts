import { describe, expect, it } from 'vitest';
import { BUILDING_H } from '../layout/constants';
import { layoutExterior } from '../layout/exterior';
import {
  ABS_MIN_ZOOM,
  COVER_SLACK,
  Camera,
  ZOOM_OUT_STEP,
  fitContinuous,
  fitZoom,
  freeCenter,
  minZoomFor,
  overviewZoom,
  stepLevel,
  stepZoom,
  wheelFactor,
  zoomLevels,
} from './camera';

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

  it('fits the overview inside the insets with the largest fitting level', () => {
    const bounds = { x: 0, y: 0, w: 700, h: 400 };
    const z = fitZoom(bounds, view, zoomLevels(2));
    expect(z).toBe(1);
    const big = { x: 0, y: 0, w: 1400, h: 400 };
    expect(fitZoom(big, view, zoomLevels(2))).toBe(0.5);
  });

  it('pans by screen delta and lets go of any pinned point', () => {
    const c = cam();
    c.zoom = c.tz = 2;
    c.frame({ x: 50, y: 50 }, 2, true);
    const before = c.cx;
    c.pan(-40, 0);
    expect(c.cx).toBe(before + 20);
    expect(c.isPinned).toBe(false);
  });
});

describe('world coverage', () => {
  const sizes: [number, number][] = [
    [1280, 720],
    [1440, 830],
    [1920, 1080],
    [2560, 1440],
    [800, 1200],
    [3440, 1440],
  ];
  const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  it('derives the minimum zoom from the canvas size, not from the free area', () => {
    const world = { x: -100, y: -50, w: 2000, h: 1000 };
    const size = { width: 1440, height: 830 };
    const min = minZoomFor(world, size);
    expect(min).toBeCloseTo(Math.max(1440 / (2000 - 2 * COVER_SLACK), 830 / (1000 - 2 * COVER_SLACK)));
    expect(minZoomFor(null, size)).toBe(ABS_MIN_ZOOM);
  });

  it('never lets zoom go below the cover zoom, however much the wheel zooms out', () => {
    const c = cam(2);
    c.world = { x: 0, y: 0, w: 1760, h: 1168 };
    c.zoom = 2;
    c.tz = 2;
    for (let i = 0; i < 80; i++) c.zoomBy(wheelFactor(120, 0, false), 900, 400);
    expect(c.tz).toBeCloseTo(c.minZoom, 9);
    for (let i = 0; i < 600; i++) c.update(1 / 60);
    expect(c.zoom).toBeGreaterThanOrEqual(c.minZoom - 1e-9);
    expect(c.zoom).toBeCloseTo(c.minZoom, 6);
  });

  it('keeps the visible rect inside the world for any window, zoom and pan', () => {
    for (const [width, height] of sizes) {
      for (const worldW of [(62 + 68) * 16, (200 + 68) * 16]) {
        const c = new Camera();
        c.dpr = 2;
        c.view = { width, height, insets: noInsets };
        c.world = { x: -34 * 16, y: -46 * 16, w: worldW, h: 125 * 16 };
        for (const z of [c.minZoom, c.minZoom * 1.7, 3, 6]) {
          c.zoom = c.tz = Math.min(6, z);
          for (const [dx, dy] of [
            [1e5, 1e5],
            [-1e5, -1e5],
            [1e5, -1e5],
            [0, 0],
          ]) {
            c.nudge(dx, dy);
            const v = c.visibleWorld();
            const w = c.world;
            expect(v.x, `${width}x${height} z${c.zoom}`).toBeGreaterThanOrEqual(w.x - 1e-6);
            expect(v.y).toBeGreaterThanOrEqual(w.y - 1e-6);
            expect(v.x + v.w).toBeLessThanOrEqual(w.x + w.w + 1e-6);
            expect(v.y + v.h).toBeLessThanOrEqual(w.y + w.h + 1e-6);
          }
        }
      }
    }
  });

  it('clamps panning at the world edge', () => {
    const c = cam(1);
    c.view = { width: 800, height: 600, insets: noInsets };
    c.world = { x: 0, y: 0, w: 2000, h: 1500 };
    c.zoom = c.tz = 1;
    c.nudge(1e6, 0);
    expect(c.cx).toBe(2000 - COVER_SLACK - 400);
    c.nudge(-1e6, -1e6);
    expect(c.cx).toBe(COVER_SLACK + 400);
    expect(c.cy).toBe(COVER_SLACK + 300);
  });

  it('is fully covered by the exterior at the overview zoom for common windows and wider buildings', () => {
    for (const [width, height] of sizes) {
      for (const sidebar of [true, false]) {
        for (const tiles of [62, 92, 132, 202]) {
          const ex = layoutExterior(tiles);
          const world = { x: ex.bounds.x * 16, y: ex.bounds.y * 16, w: ex.bounds.w * 16, h: ex.bounds.h * 16 };
          const view = { width, height, insets: { top: 56, right: 0, bottom: 56, left: sidebar ? 320 : 0 } };
          const building = { w: tiles * 16, h: BUILDING_H * 16 };
          const min = minZoomFor(world, view);
          const z = overviewZoom(building, view, 2, min);
          const label = `${width}x${height} sidebar=${sidebar} tiles=${tiles}`;
          expect(z, label).toBeGreaterThanOrEqual(min);
          const freeW = view.width - view.insets.left - view.insets.right;
          const freeH = view.height - view.insets.top - view.insets.bottom;
          // up to 11 project rooms the whole building stays inside the free area (the cover rule never crops it);
          // beyond that, on a short window, the cover rule wins and the overview may crop the ends
          // (portrait windows are only checked for the cover rule: they are far outside the desktop layout)
          if (tiles > 132 || width < height) continue;
          expect(building.w * z, label).toBeLessThanOrEqual(freeW + 1e-6);
          expect(building.h * z, label).toBeLessThanOrEqual(freeH + 1e-6);
        }
      }
    }
  });

  it('steps by buttons down to the cover zoom and stops there', () => {
    const levels = zoomLevels(2);
    expect(stepZoom(levels, 1, -1, 0.82)).toBeCloseTo(0.82);
    expect(stepZoom(levels, 0.82, -1, 0.82)).toBeCloseTo(0.82);
    expect(stepZoom(levels, 0.82, 1, 0.82)).toBe(1);
    expect(stepZoom(levels, 6, 1, 0.82)).toBe(6);
  });
});

describe('zoom-out range', () => {
  const win = { width: 1440, height: 830 };
  const insets = { top: 56, right: 0, bottom: 64, left: 344 };
  const building = { w: 63 * 16, h: 29 * 16 };

  function overviewCam(size = building): Camera {
    const c = new Camera();
    c.dpr = 2;
    c.view = { ...win, insets };
    c.world = { x: -60 * 16, y: -40 * 16, w: 200 * 16, h: 110 * 16 };
    c.building = size;
    const ov = overviewZoom(size, c.view, 2, c.minZoom);
    c.frame({ x: size.w / 2, y: size.h / 2 }, ov, true);
    return c;
  }

  it('lets the camera go exactly one step below the overview and no further', () => {
    const c = overviewCam();
    const overview = c.zoom;
    expect(c.minZoom).toBeCloseTo(overview / ZOOM_OUT_STEP, 9);
    for (let i = 0; i < 60; i++) c.zoomBy(wheelFactor(120, 0, false), 700, 400);
    expect(c.tz).toBeCloseTo(overview / ZOOM_OUT_STEP, 9);
  });

  it('stops the - button at the floor on the first press', () => {
    const c = overviewCam();
    c.step(-1);
    expect(c.tz).toBeCloseTo(c.minZoom, 9);
    c.step(-1);
    expect(c.tz).toBeCloseTo(c.minZoom, 9);
  });

  it('eases down to the floor without overshoot or bounce, showing nothing outside the world', () => {
    const c = overviewCam();
    const floor = c.minZoom;
    const zooms: number[] = [];
    for (let i = 0; i < 90; i++) {
      c.zoomBy(wheelFactor(120, 0, false), 1200, 100);
      c.update(1 / 60);
      zooms.push(c.zoom);
      const v = c.visibleWorld();
      expect(v.x).toBeGreaterThanOrEqual(c.world!.x - 1e-6);
      expect(v.x + v.w).toBeLessThanOrEqual(c.world!.x + c.world!.w + 1e-6);
      expect(v.y).toBeGreaterThanOrEqual(c.world!.y - 1e-6);
      expect(v.y + v.h).toBeLessThanOrEqual(c.world!.y + c.world!.h + 1e-6);
    }
    for (let i = 1; i < zooms.length; i++) expect(zooms[i]).toBeLessThanOrEqual(zooms[i - 1] + 1e-12);
    expect(Math.min(...zooms)).toBeGreaterThanOrEqual(floor - 1e-9);
    for (let i = 0; i < 300; i++) c.update(1 / 60);
    expect(c.zoom).toBeCloseTo(floor, 6);
  });

  it('reaches a floor that moves (a panel closing) smoothly instead of jumping', () => {
    const c = overviewCam({ w: 93 * 16, h: 29 * 16 });
    c.step(-1);
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    const before = c.zoom;
    c.view = { ...c.view, insets: { ...insets, left: 0 } };
    c.update(1 / 60);
    expect(c.minZoom).toBeGreaterThan(before);
    expect(c.zoom).toBeLessThan(c.minZoom);
    expect(c.zoom).toBeGreaterThanOrEqual(before - 1e-9);
    for (let i = 0; i < 300; i++) c.update(1 / 60);
    expect(c.zoom).toBeCloseTo(c.minZoom, 6);
  });

  it('falls back to the cover zoom when the world cannot cover the canvas any lower', () => {
    const c = overviewCam();
    c.world = { x: 0, y: 0, w: 1600, h: 900 };
    expect(c.minZoom).toBeCloseTo(c.coverZoom, 9);
    expect(c.minZoom).toBeGreaterThan(overviewZoom(building, c.view, 2) / ZOOM_OUT_STEP);
  });
});

describe('wheel input', () => {
  it('zooms in for negative deltas and out for positive, by reciprocal ratios', () => {
    expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false) * wheelFactor(-100, 0, false)).toBeCloseTo(1, 9);
  });

  it('is more sensitive for a trackpad pinch than for a wheel at the same delta, and bounds a single event', () => {
    expect(wheelFactor(-5, 0, true)).toBeGreaterThan(wheelFactor(-5, 0, false));
    expect(wheelFactor(-100000, 0, false)).toBeLessThanOrEqual(1.5);
    expect(wheelFactor(100000, 0, false)).toBeGreaterThanOrEqual(1 / 1.5);
  });

  it('reads line and page deltas as larger than pixels', () => {
    expect(wheelFactor(-3, 1, false)).toBeGreaterThan(wheelFactor(-3, 0, false));
  });
});

describe('smooth zoom', () => {
  function worldCam(): Camera {
    const c = cam(2);
    c.view = { width: 1440, height: 830, insets: { top: 56, right: 0, bottom: 80, left: 320 } };
    c.world = { x: -544, y: -544, w: 2080, h: 1552 };
    c.cx = 500;
    c.cy = 300;
    c.zoom = c.tz = 2;
    return c;
  }

  it('keeps the world point under the cursor fixed all through a wheel zoom', () => {
    const c = worldCam();
    const cursor = { x: 900, y: 400 };
    const anchor = c.screenToWorld(cursor.x, cursor.y);
    c.zoomBy(1.5, cursor.x, cursor.y);
    const seen: number[] = [];
    for (let i = 0; i < 90; i++) {
      c.update(1 / 60);
      seen.push(c.zoom);
      const at = c.screenToWorld(cursor.x, cursor.y);
      expect(at.x).toBeCloseTo(anchor.x, 6);
      expect(at.y).toBeCloseTo(anchor.y, 6);
    }
    expect(c.zoom).toBeCloseTo(3, 9);
    // intermediate values: monotonic and strictly between start and target during the ease
    expect(seen[2]).toBeGreaterThan(2);
    expect(seen[2]).toBeLessThan(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });

  it('converges to its target and reports settled, at any frame rate', () => {
    for (const fps of [30, 60, 144]) {
      const c = worldCam();
      c.zoomBy(1.4, 700, 300);
      let moving = true;
      for (let i = 0; i < fps * 3 && moving; i++) moving = c.update(1 / fps);
      expect(moving, `${fps} fps`).toBe(false);
      expect(c.zoom).toBe(c.tz);
    }
  });

  it('is frame-rate independent: the same elapsed time gives the same zoom', () => {
    const slow = worldCam();
    const fast = worldCam();
    slow.zoomBy(1.4, 700, 300);
    fast.zoomBy(1.4, 700, 300);
    for (let i = 0; i < 6; i++) slow.update(1 / 30);
    for (let i = 0; i < 24; i++) fast.update(1 / 120);
    expect(fast.zoom).toBeCloseTo(slow.zoom, 6);
  });

  it('button steps animate in roughly a fifth of a second and stay centred on the free area', () => {
    const c = worldCam();
    const fc = freeCenter(c.view);
    const before = c.screenToWorld(fc.x, fc.y);
    c.step(1);
    expect(c.tz).toBe(3);
    c.update(0.05);
    expect(c.zoom).toBeGreaterThan(2);
    expect(c.zoom).toBeLessThan(3);
    for (let i = 0; i < 9; i++) c.update(1 / 60);
    expect(Math.log(3 / c.zoom)).toBeLessThan(Math.log(1.5) * 0.08);
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    const after = c.screenToWorld(fc.x, fc.y);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('applies zoom and focus at once when reduced motion is on', () => {
    const c = worldCam();
    c.step(1);
    c.update(1 / 60, true);
    expect(c.zoom).toBe(3);
    c.frame({ x: 800, y: 600 }, 2, false);
    c.update(1 / 60, true);
    expect(c.zoom).toBe(2);
    expect(c.settled).toBe(true);
  });

  it('keeps a pinned point framed while zooming with the buttons', () => {
    const c = worldCam();
    c.frame({ x: 640, y: 240 }, 2, true);
    c.step(1);
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    const fc = freeCenter(c.view);
    const s = c.worldToScreen(640, 240);
    expect(s.x).toBeCloseTo(fc.x, 6);
    expect(s.y).toBeCloseTo(fc.y, 6);
  });
});

describe('framing with insets', () => {
  const insets = { top: 56, right: 380, bottom: 80, left: 320 };

  function framed(): Camera {
    const c = cam(2);
    c.view = { width: 1440, height: 830, insets: { top: 56, right: 0, bottom: 80, left: 320 } };
    c.world = { x: -544, y: -544, w: 2080, h: 1552 };
    c.zoom = c.tz = 1;
    c.cx = 400;
    c.cy = 300;
    return c;
  }

  it('centres a focus point in the free area, not the full window', () => {
    const c = cam();
    c.frame({ x: 640, y: 240 }, 4, true);
    const s = c.worldToScreen(640, 240);
    expect(s.x).toBeCloseTo(320 + (1440 - 320 - 380) / 2);
    expect(s.y).toBeCloseTo(56 + (900 - 56) / 2);
  });

  it('re-targets when the drawer opens after the focus started (stale insets)', () => {
    const c = framed();
    const person = { x: 700, y: 330 };
    c.frame(person, 3, false);
    for (let i = 0; i < 3; i++) c.update(1 / 60);
    c.setInsets(insets);
    for (let i = 0; i < 240; i++) c.update(1 / 60);
    const fc = freeCenter(c.view);
    const s = c.worldToScreen(person.x, person.y);
    expect(c.view.insets.right).toBe(380);
    expect(s.x).toBeCloseTo(fc.x, 3);
    expect(s.y).toBeCloseTo(fc.y, 3);
    expect(c.settled).toBe(true);
  });

  it('re-targets when the drawer opens after the focus settled', () => {
    const c = framed();
    const person = { x: 700, y: 330 };
    c.frame(person, 3, true);
    c.setInsets(insets);
    for (let i = 0; i < 240; i++) c.update(1 / 60);
    const fc = freeCenter(c.view);
    const s = c.worldToScreen(person.x, person.y);
    expect(s.x).toBeCloseTo(fc.x, 3);
    expect(s.y).toBeCloseTo(fc.y, 3);
  });

  it('follows a moving person with a bounded lag and arrives once it stops', () => {
    const c = framed();
    c.setInsets(insets, true);
    c.frame({ x: 700, y: 330 }, 3, true);
    let x = 700;
    for (let i = 0; i < 120; i++) {
      x += 1;
      c.follow({ x, y: 330 });
      c.update(1 / 60);
    }
    const fc = freeCenter(c.view);
    // the lag of an exponential ease behind a target moving at v css px/s is v / rate (180 / 9 = 20 px here)
    expect(Math.abs(c.worldToScreen(x, 330).x - fc.x)).toBeLessThan(22);
    for (let i = 0; i < 120; i++) c.update(1 / 60);
    expect(c.worldToScreen(x, 330).x).toBeCloseTo(fc.x, 3);
  });

  it('stops following once the user pans', () => {
    const c = framed();
    c.frame({ x: 700, y: 330 }, 3, true);
    c.pan(30, 0);
    expect(c.isPinned).toBe(false);
    const cx = c.cx;
    c.update(1 / 60);
    expect(c.cx).toBe(cx);
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
  const windowOf = (width: number, height: number, insets = { top: 56, right: 0, bottom: 56, left: 320 }) => ({
    width,
    height,
    insets,
  });
  /** 4 rooms: 62 x 29 tiles. */
  const building = { w: 62 * 16, h: 29 * 16 };

  function fits(zoom: number, view: ReturnType<typeof windowOf>): boolean {
    const freeW = view.width - view.insets.left - view.insets.right;
    const freeH = view.height - view.insets.top - view.insets.bottom;
    return building.w * zoom <= freeW && building.h * zoom <= freeH;
  }

  it('shows the whole building inside the insets at common sizes, at DPR 1 and 2', () => {
    for (const [w, h] of [
      [1280, 720],
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
    ]) {
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
    expect(z).toBeGreaterThanOrEqual(
      fitContinuous({ x: 0, y: 0, w: building.w + 128, h: building.h + 128 }, view, 12) - 1e-9,
    );
  });

  it('never exceeds the maximum zoom for a tiny building on a huge window', () => {
    expect(overviewZoom({ w: 100, h: 80 }, windowOf(2560, 1440), 1)).toBeLessThanOrEqual(6);
  });
});

describe('animated framing', () => {
  it('eases the zoom to its target together with the centre', () => {
    const c = cam(1);
    c.zoom = c.tz = 2;
    c.frame({ x: 400, y: 300 }, 0.75, false);
    expect(c.tz).toBe(0.75);
    let moving = true;
    for (let i = 0; i < 400 && moving; i++) moving = c.update(1 / 60);
    expect(moving).toBe(false);
    expect(c.zoom).toBe(0.75);
    const s = c.worldToScreen(400, 300);
    expect(s.x).toBeCloseTo(320 + (1440 - 320 - 380) / 2, 0);
  });

  it('applies the zoom at once when instant', () => {
    const c = cam(1);
    c.frame({ x: 0, y: 0 }, 1.5, true);
    expect(c.zoom).toBe(1.5);
    expect(c.settled).toBe(true);
  });
});
