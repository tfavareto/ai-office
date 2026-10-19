// Pure camera math for the 2D world. World units are pixels at zoom 1 (1 tile = 16 px); screen units are CSS px.
import type { ViewInsets } from '../world/api';

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
  insets: ViewInsets;
}

export interface Anchor {
  /** Screen point (CSS px) that keeps showing the world point (wx, wy) while the zoom changes. */
  sx: number;
  sy: number;
  wx: number;
  wy: number;
}

/** Smallest zoom the overview may pick on a tiny window. */
export const MIN_FIT_ZOOM = 0.25;
/** Hard floor of the zoom range; the real minimum is the zoom at which the world still covers the view. */
export const ABS_MIN_ZOOM = 0.1;
export const MAX_ZOOM = 6;
/** World px kept as a safety band at every edge of the world, so rounding to device pixels never shows the page behind. */
export const COVER_SLACK = 4;

const BASE_LEVELS = [0.5, 1, 1.5, 2, 3, 4, 5, 6];
const LEVEL_FLOOR = 0.5;
/** Margin (tiles of 16 px) kept around the building in the overview: comfortable first, tight when it buys a crisp integer zoom. */
const COMFY_MARGIN = 64;
const TIGHT_MARGIN = 24;
const COMFY_PAD = 12;
const TIGHT_PAD = 6;
/** A crisp integer device scale is preferred when it keeps at least this share of the comfortable zoom. */
const CRISP_MIN_SHARE = 0.82;
/** Zoom steps smaller than this ratio are skipped, so one button press always changes the picture. */
const MIN_STEP_RATIO = 1.04;
const ZOOM_EPS = 1e-6;
/** Zoom the camera settles at when focusing a person: close enough to read, far enough to keep the room around. */
const FOCUS_ZOOM = 3;
const FOCUS_ZOOM_FALLBACK = 2;

// Wheel input: exponential in the scroll distance, so every notch is the same ratio at any zoom.
const WHEEL_SENSITIVITY = 0.0018;
const PINCH_SENSITIVITY = 0.012;
const WHEEL_LINE_PX = 33;
const WHEEL_PAGE_PX = 400;
const MAX_EVENT_FACTOR = 1.5;

/** Zoom levels whose device scale (zoom x DPR) is a whole number, so pixels stay perfectly square. */
export function zoomLevels(dpr: number): number[] {
  const levels = BASE_LEVELS.filter((z) => Math.abs(z * dpr - Math.round(z * dpr)) < 1e-6 || z === LEVEL_FLOOR);
  return levels.length ? levels : [1, 2, 3, 4, 5, 6];
}

export function nearestLevel(levels: readonly number[], zoom: number): number {
  return levels.reduce((best, z) => (Math.abs(z - zoom) < Math.abs(best - zoom) ? z : best), levels[0]);
}

/** Next level in/out from any zoom (the overview zoom is usually between two levels). Stays put at the ends. */
export function stepLevel(levels: readonly number[], zoom: number, direction: 1 | -1): number {
  if (direction === 1) return levels.find((z) => z > zoom * MIN_STEP_RATIO) ?? Math.max(zoom, levels[levels.length - 1]);
  const below = levels.filter((z) => z < zoom / MIN_STEP_RATIO);
  return below.length ? below[below.length - 1] : Math.min(zoom, levels[0]);
}

/** Button/key zoom: the next level, with `min` (the cover zoom) as the last stop instead of a level below it. */
export function stepZoom(levels: readonly number[], zoom: number, direction: 1 | -1, min: number): number {
  const stops = [min, ...levels.filter((z) => z > min * MIN_STEP_RATIO)].filter((z) => z <= MAX_ZOOM);
  return Math.min(MAX_ZOOM, Math.max(min, stepLevel(stops, zoom, direction)));
}

/** Zoom ratio of one wheel event. A pinch (ctrlKey) sends small deltas, so it is far more sensitive than a wheel notch. */
export function wheelFactor(deltaY: number, deltaMode: number, isPinch: boolean): number {
  const unit = deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1;
  const raw = Math.exp(-deltaY * unit * (isPinch ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY));
  return Math.min(MAX_EVENT_FACTOR, Math.max(1 / MAX_EVENT_FACTOR, raw));
}

/** Zoom to use when a person is brought into view: a level that is comfortable, never zooming out from a closer view. */
export function focusZoom(current: number, levels: readonly number[]): number {
  if (current >= FOCUS_ZOOM) return current;
  return levels.includes(FOCUS_ZOOM) ? FOCUS_ZOOM : FOCUS_ZOOM_FALLBACK;
}

/** Centre of the free area (not covered by panels), in screen px. */
export function freeCenter(view: Viewport): Point {
  const { insets } = view;
  return {
    x: insets.left + (view.width - insets.left - insets.right) / 2,
    y: insets.top + (view.height - insets.top - insets.bottom) / 2,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// world coverage

/** Smallest zoom at which `world` (minus a safety band) covers the whole `size` of the canvas. */
export function coverZoom(world: Bounds, size: { width: number; height: number }): number {
  const w = Math.max(1, world.w - COVER_SLACK * 2);
  const h = Math.max(1, world.h - COVER_SLACK * 2);
  return Math.max(size.width / w, size.height / h);
}

/** Lowest zoom the camera may show: the cover zoom of the world, or the hard floor while the world is unknown. */
export function minZoomFor(world: Bounds | null, size: { width: number; height: number }): number {
  if (!world) return ABS_MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(ABS_MIN_ZOOM, coverZoom(world, size)));
}

export function clampZoom(zoom: number, min: number): number {
  return Math.min(MAX_ZOOM, Math.max(min, zoom));
}

function clampAxis(value: number, half: number, lo: number, hi: number): number {
  if (hi - lo <= half * 2) return (lo + hi) / 2;
  return Math.min(hi - half, Math.max(lo + half, value));
}

/** Moves the view centre (world px) so the visible rect stays inside `world`. No world means no limit. */
export function clampCenter(center: Point, zoom: number, size: { width: number; height: number }, world: Bounds | null): Point {
  if (!world) return center;
  return {
    x: clampAxis(center.x, size.width / zoom / 2, world.x + COVER_SLACK, world.x + world.w - COVER_SLACK),
    y: clampAxis(center.y, size.height / zoom / 2, world.y + COVER_SLACK, world.y + world.h - COVER_SLACK),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// view centre for each way of holding the camera

/** View centre (world px) that keeps `anchor`'s world point under its screen point at `zoom`. */
export function anchoredCenter(anchor: Anchor, zoom: number, size: { width: number; height: number }): Point {
  return { x: anchor.wx - (anchor.sx - size.width / 2) / zoom, y: anchor.wy - (anchor.sy - size.height / 2) / zoom };
}

/** View centre (world px) that puts world point `p` in the middle of the free area (the view minus its insets). */
export function pinnedCenter(p: Point, zoom: number, view: Viewport): Point {
  const fc = freeCenter(view);
  return { x: p.x - (fc.x - view.width / 2) / zoom, y: p.y - (fc.y - view.height / 2) / zoom };
}

/** World point under screen point (sx, sy) for a camera centred at `center`. */
export function worldAt(center: Point, zoom: number, size: { width: number; height: number }, sx: number, sy: number): Point {
  return { x: (sx - size.width / 2) / zoom + center.x, y: (sy - size.height / 2) / zoom + center.y };
}

// ---------------------------------------------------------------------------------------------------------------
// easing (frame-rate independent)

/** Share of the remaining distance covered in `dt` seconds by an exponential ease with the given rate (1/s). */
export function easeFactor(dt: number, rate: number): number {
  return 1 - Math.exp(-Math.max(0, dt) * rate);
}

export function easeValue(current: number, target: number, k: number, snap = 0.02): number {
  return k >= 1 || Math.abs(target - current) < snap ? target : current + (target - current) * k;
}

/** Zoom eases on a log scale, so zooming in and out of the same distance feels the same. */
export function easeZoom(current: number, target: number, k: number): number {
  if (k >= 1 || Math.abs(Math.log(target / current)) < 1e-3) return target;
  return current * Math.pow(target / current, k);
}

// ---------------------------------------------------------------------------------------------------------------
// overview

/** Largest zoom level that still fits `bounds` inside the free area (or the exact fit when even the smallest level overflows). */
export function fitZoom(bounds: Bounds, view: Viewport, levels: readonly number[]): number {
  const freeW = Math.max(40, view.width - view.insets.left - view.insets.right);
  const freeH = Math.max(40, view.height - view.insets.top - view.insets.bottom);
  const fit = Math.min(freeW / bounds.w, freeH / bounds.h);
  const fitting = levels.filter((z) => z <= fit + 1e-9);
  return fitting.length ? fitting[fitting.length - 1] : Math.max(0.05, fit);
}

function freeSize(view: Viewport, pad: number): { w: number; h: number } {
  return {
    w: Math.max(40, view.width - view.insets.left - view.insets.right - pad * 2),
    h: Math.max(40, view.height - view.insets.top - view.insets.bottom - pad * 2),
  };
}

/** Exact (continuous) zoom at which `bounds` plus `pad` CSS px on every side fills the free area. */
export function fitContinuous(bounds: Bounds, view: Viewport, pad = 0): number {
  const free = freeSize(view, pad);
  return Math.min(MAX_ZOOM, Math.max(MIN_FIT_ZOOM, Math.min(free.w / bounds.w, free.h / bounds.h)));
}

/**
 * Zoom of the overview: the whole `building` (world px, origin at 0,0) inside the free area with a small margin.
 * A whole device-pixel scale (crisp pixel art) is used when it fits and wastes little; otherwise the exact
 * continuous fit, so any window size from tiny to ultra-wide shows the complete building. Never below `minZoom`
 * (the zoom at which the world covers the window).
 */
export function overviewZoom(building: { w: number; h: number }, view: Viewport, dpr: number, minZoom = 0): number {
  const comfy = fitContinuous({ x: 0, y: 0, w: building.w + COMFY_MARGIN * 2, h: building.h + COMFY_MARGIN * 2 }, view, COMFY_PAD);
  const tight = fitContinuous({ x: 0, y: 0, w: building.w + TIGHT_MARGIN * 2, h: building.h + TIGHT_MARGIN * 2 }, view, TIGHT_PAD);
  const crisp = Math.floor(tight * dpr + ZOOM_EPS) / dpr;
  const zoom = crisp * dpr >= 1 && crisp >= comfy * CRISP_MIN_SHARE ? Math.min(MAX_ZOOM, crisp) : comfy;
  return Math.max(zoom, minZoom);
}
