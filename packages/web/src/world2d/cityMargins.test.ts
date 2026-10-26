import { describe, expect, it } from 'vitest';
import { BUILDING_H, TILE } from '../layout/constants';
import { MIN_EXTERIOR_MARGIN, layoutExterior } from '../layout/exterior';
import { rowEnds } from '../layout/slots';
import { computeInsets } from '../ui/layout';
import { Camera, ZOOM_OUT_STEP, overviewZoom, zoomOutFloor } from './camera';
import { type CityWindow, MARGIN_STEP, cityMargins, growWindow, overshootAtMinZoom } from './cityMargins';

/** Width in tiles of the building with `rooms` project rooms. */
function widthOf(rooms: number): number {
  const ends = rowEnds(rooms);
  return Math.max(ends.north, ends.south) + 1;
}

function cameraFor(rooms: number, win: CityWindow, sidebarOpen: boolean): Camera {
  const tiles = widthOf(rooms);
  const b = layoutExterior(tiles, cityMargins(tiles, win)).bounds;
  const cam = new Camera();
  cam.dpr = win.dpr;
  cam.view = {
    width: win.width,
    height: win.height,
    insets: computeInsets({ sidebarOpen, feedOpen: false, drawerOpen: false, narrow: false }),
  };
  cam.world = { x: b.x * TILE, y: b.y * TILE, w: b.w * TILE, h: b.h * TILE };
  cam.building = { w: tiles * TILE, h: BUILDING_H * TILE };
  return cam;
}

const WINDOWS: [number, number][] = [
  [1280, 720],
  [1440, 830],
  [1920, 1080],
  [2560, 1440],
];
const ROOMS = Array.from({ length: 12 }, (_, i) => i + 1);

describe('zoom-out floor', () => {
  it('is one button step below the overview', () => {
    expect(zoomOutFloor(1)).toBeCloseTo(1 / ZOOM_OUT_STEP);
    expect(zoomOutFloor(2)).toBeCloseTo(2 / ZOOM_OUT_STEP);
  });

  it('gives no step to a building that already fills the window at the smallest zoom level', () => {
    expect(zoomOutFloor(0.5)).toBe(0.5);
    expect(zoomOutFloor(0.4)).toBe(0.4);
    expect(zoomOutFloor(0.55)).toBeCloseTo(0.5);
  });
});

describe('city margins', () => {
  it('covers the canvas at the lowest zoom for every window, sidebar state and number of rooms', () => {
    for (const [width, height] of WINDOWS) {
      for (const dpr of [1, 2]) {
        for (const sidebarOpen of [true, false]) {
          for (const rooms of ROOMS) {
            const cam = cameraFor(rooms, { width, height, dpr }, sidebarOpen);
            const label = `${width}x${height}@${dpr} sidebar=${sidebarOpen} rooms=${rooms}`;
            const overview = overviewZoom(cam.building!, cam.view, dpr);
            // the world never limits the zoom-out step
            expect(cam.coverZoom, label).toBeLessThanOrEqual(zoomOutFloor(overview) + 1e-9);
            expect(cam.minZoom, label).toBeCloseTo(zoomOutFloor(overview), 9);
            // and the view centred on the overview point stays inside the world at that zoom
            cam.zoom = cam.tz = cam.minZoom;
            cam.frame({ x: cam.building!.w / 2, y: cam.building!.h / 2 }, cam.minZoom, true);
            const v = cam.visibleWorld();
            const w = cam.world!;
            expect(v.x, label).toBeGreaterThanOrEqual(w.x - 1e-6);
            expect(v.y, label).toBeGreaterThanOrEqual(w.y - 1e-6);
            expect(v.x + v.w, label).toBeLessThanOrEqual(w.x + w.w + 1e-6);
            expect(v.y + v.h, label).toBeLessThanOrEqual(w.y + w.h + 1e-6);
          }
        }
      }
    }
  });

  it('covers landscape windows from 4:3 to 21:9', () => {
    for (const aspect of [4 / 3, 3 / 2, 16 / 10, 16 / 9, 2, 21 / 9]) {
      const height = 900;
      const win = { width: Math.round(height * aspect), height, dpr: 2 };
      for (const rooms of [1, 4, 8, 12]) {
        for (const sidebarOpen of [true, false]) {
          const cam = cameraFor(rooms, win, sidebarOpen);
          expect(cam.coverZoom, `aspect ${aspect.toFixed(2)} rooms=${rooms}`).toBeLessThanOrEqual(cam.minZoom + 1e-9);
        }
      }
    }
  });

  it('keeps the margins in whole steps and never below what the street frame needs', () => {
    for (const rooms of ROOMS) {
      const m = cityMargins(widthOf(rooms), { width: 1440, height: 830, dpr: 2 });
      for (const side of [m.left, m.right, m.top, m.bottom]) {
        expect(side % MARGIN_STEP).toBe(0);
        expect(side).toBeGreaterThanOrEqual(MIN_EXTERIOR_MARGIN);
      }
    }
  });

  it('puts more city on the side the sidebar pushes the building away from', () => {
    const m = cityMargins(widthOf(4), { width: 1440, height: 830, dpr: 2 });
    expect(m.left).toBeGreaterThan(m.right);
  });

  it('is much smaller than the previous fixed city for a typical window', () => {
    const tiles = widthOf(4);
    const m = cityMargins(tiles, { width: 1440, height: 830, dpr: 2 });
    const area = (tiles + m.left + m.right) * (BUILDING_H + m.top + m.bottom);
    const previous = (tiles + 34 * 2) * (BUILDING_H + 46 * 2);
    expect(area).toBeLessThan(previous * 0.7);
  });

  it('grows with the building and keeps the largest window it has seen', () => {
    const win = { width: 1440, height: 830, dpr: 2 };
    const few = cityMargins(widthOf(1), win);
    const many = cityMargins(widthOf(12), win);
    expect(many.top + many.bottom).toBeGreaterThan(few.top + few.bottom);
    const grown = growWindow({ width: 1920, height: 1080, dpr: 2 }, { width: 1280, height: 720, dpr: 1 });
    expect(grown).toEqual({ width: 1920, height: 1080, dpr: 1 });
    expect(growWindow(null, { width: 800, height: 600, dpr: 2 })).toEqual({ width: 800, height: 600, dpr: 2 });
  });

  it('measures how far the canvas reaches beyond the building at the lowest zoom', () => {
    const building = { w: widthOf(4) * TILE, h: BUILDING_H * TILE };
    const insets = computeInsets({ sidebarOpen: false, feedOpen: false, drawerOpen: false, narrow: false });
    const view = { width: 1440, height: 830, insets };
    const o = overshootAtMinZoom(building, view, 2);
    const min = zoomOutFloor(overviewZoom(building, view, 2));
    // no sidebar: the view is centred on the building, so it reaches the same distance on both sides
    expect(o.left).toBeCloseTo(o.right, 6);
    expect(o.left + o.right + building.w).toBeCloseTo(1440 / min, 6);
  });
});
