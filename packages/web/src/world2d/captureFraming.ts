// Framing math of a 2D capture (pure): which part of the world a still image shows and at which zoom it is drawn.
// World units are pixels at zoom 1 (1 tile = 16 px).
import type { Bounds, Point } from './cameraMath';

/** World px kept around the building in the overview (a strip of sidewalk and street). */
export const CAPTURE_MARGIN = 40;
/** Largest side of the canvas the world is drawn on before it is scaled to the requested size. */
export const MAX_RENDER_SIDE = 6144;

export interface Size {
  width: number;
  height: number;
}

export interface CaptureFraming {
  /** World point at the middle of the picture. */
  center: Point;
  /** Zoom at which the picture shows the region at the requested size (may be a fraction). */
  fit: number;
  /** Zoom the world is actually drawn at: a whole number when `fit` is above 1, so the pixel art stays crisp. */
  zoom: number;
  /** Size of the canvas the world is drawn on; scaled by `fit / zoom` to the requested size. */
  render: Size;
}

/**
 * Draw zoom for a picture that needs `fit`. Above 1 the art is drawn at the next whole zoom (every art pixel is the
 * same number of device pixels) and scaled down; below 1 it is drawn at the fit itself. The drawn canvas stays under
 * `MAX_RENDER_SIDE`.
 */
export function renderPlan(fit: number, out: Size): { zoom: number; render: Size } {
  let zoom = fit <= 1 ? fit : Math.ceil(fit - 1e-6);
  const side = Math.max(out.width, out.height);
  while (zoom > fit && (side * zoom) / fit > MAX_RENDER_SIDE) zoom = Math.max(fit, zoom - 1);
  const scale = zoom / fit;
  return {
    zoom,
    render: { width: Math.max(1, Math.ceil(out.width * scale)), height: Math.max(1, Math.ceil(out.height * scale)) },
  };
}

function framing(center: Point, fit: number, out: Size): CaptureFraming {
  const safeFit = Math.max(1e-3, fit);
  return { center, fit: safeFit, ...renderPlan(safeFit, out) };
}

/** The whole building (world px, origin at 0,0) with a margin, centred in a picture of `out`. */
export function overviewFraming(building: Size, out: Size, margin = CAPTURE_MARGIN): CaptureFraming {
  const fit = Math.min(out.width / (building.width + margin * 2), out.height / (building.height + margin * 2));
  return framing({ x: building.width / 2, y: building.height / 2 }, fit, out);
}

/** What the live camera shows now: the free area of its view around `center`, scaled to fit the picture. */
export function currentFraming(live: { zoom: number; center: Point; free: Size }, out: Size): CaptureFraming {
  const fit =
    live.zoom * Math.min(out.width / Math.max(1, live.free.width), out.height / Math.max(1, live.free.height));
  return framing(live.center, fit, out);
}

/** The picture's visible world rect stays inside `world` (no strip of nothing at the edges); no world means no limit. */
export function keepInside(framing: CaptureFraming, out: Size, world: Bounds | null): Point {
  if (!world) return framing.center;
  const halfW = out.width / framing.fit / 2;
  const halfH = out.height / framing.fit / 2;
  const axis = (value: number, half: number, lo: number, hi: number): number =>
    hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, value));
  return {
    x: axis(framing.center.x, halfW, world.x, world.x + world.w),
    y: axis(framing.center.y, halfH, world.y, world.y + world.h),
  };
}
