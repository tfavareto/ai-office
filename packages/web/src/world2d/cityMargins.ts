// How much city the 2D world needs around the building. Pure: it replays the zoom rule of the camera.
//
// The camera may go one step out from the overview (the normal view of the building) and no further, and it never
// shows anything outside the drawn world. So the world has to cover the canvas at that lowest zoom. For a window
// this module finds the smallest margin on each side for which that holds, whether the sidebar is open or closed.
// Any shape of window works (4:3 to 21:9 and beyond): the margin follows the window, not a fixed aspect ratio.
import { BUILDING_H, TILE } from '../layout/constants';
import { type ExteriorMargins, MIN_EXTERIOR_MARGIN } from '../layout/exterior';
import { NARROW_BREAKPOINT } from '../ui/state';
import { computeInsets } from '../ui/layout';
import { COVER_SLACK, type Viewport, overviewZoom, pinnedCenter, zoomOutFloor } from './cameraMath';

/** The canvas of the world, in CSS px, and the device pixel ratio it is drawn at. */
export interface CityWindow {
  width: number;
  height: number;
  dpr: number;
}

/** The window stills are drawn for, where no live canvas exists: a large desktop one, so the city never runs short. */
export const REFERENCE_WINDOW: CityWindow = { width: 2560, height: 1440, dpr: 2 };

/** Margins grow in whole steps of this many tiles, so a window resize rebuilds the city rarely, never per pixel. */
export const MARGIN_STEP = 4;
/** Extra tiles kept beyond what the lowest zoom shows, so no rounding or small layout change ever reaches the edge. */
const SAFETY_TILES = 2;

interface Size {
  w: number;
  h: number;
}

interface Sides {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The two views a window can have: the sidebar open and closed (the panels of a narrow window are overlays). */
function viewsOf(win: CityWindow): Viewport[] {
  const narrow = win.width < NARROW_BREAKPOINT;
  const states = narrow ? [false] : [true, false];
  return states.map((sidebarOpen) => ({
    width: win.width,
    height: win.height,
    insets: computeInsets({ sidebarOpen, feedOpen: false, drawerOpen: false, narrow }),
  }));
}

/**
 * World px the canvas shows beyond each edge of the building (origin 0,0) at the lowest zoom of `view`, with the
 * camera on the overview point. Negative when the canvas stays inside the building on that side.
 */
export function overshootAtMinZoom(building: Size, view: Viewport, dpr: number): Sides {
  const min = zoomOutFloor(overviewZoom(building, view, dpr));
  const c = pinnedCenter({ x: building.w / 2, y: building.h / 2 }, min, view);
  const halfW = view.width / min / 2;
  const halfH = view.height / min / 2;
  return { left: halfW - c.x, right: c.x + halfW - building.w, top: halfH - c.y, bottom: c.y + halfH - building.h };
}

/** Whole tiles, in steps of `MARGIN_STEP`, that hold `px` world px plus the cover slack and the safety band. */
function marginTiles(px: number): number {
  const tiles = Math.ceil((px + COVER_SLACK) / TILE) + SAFETY_TILES;
  return Math.max(MIN_EXTERIOR_MARGIN, Math.ceil(tiles / MARGIN_STEP) * MARGIN_STEP);
}

/**
 * Margins (tiles) of the 2D city for a building `buildingTiles` wide seen in `win`: the largest overshoot at the
 * lowest zoom over both sidebar states, never below what the street frame needs.
 */
export function cityMargins(buildingTiles: number, win: CityWindow): ExteriorMargins {
  const building = { w: buildingTiles * TILE, h: BUILDING_H * TILE };
  const need: Sides = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const view of viewsOf(win)) {
    const o = overshootAtMinZoom(building, view, win.dpr);
    need.left = Math.max(need.left, o.left);
    need.right = Math.max(need.right, o.right);
    need.top = Math.max(need.top, o.top);
    need.bottom = Math.max(need.bottom, o.bottom);
  }
  return {
    left: marginTiles(need.left),
    right: marginTiles(need.right),
    top: marginTiles(need.top),
    bottom: marginTiles(need.bottom),
  };
}

/** The window the city is built for: it only ever grows, so shrinking and enlarging a window again never rebuilds. */
export function growWindow(previous: CityWindow | null, next: CityWindow): CityWindow {
  return {
    width: Math.max(previous?.width ?? 0, next.width),
    height: Math.max(previous?.height ?? 0, next.height),
    dpr: next.dpr,
  };
}
