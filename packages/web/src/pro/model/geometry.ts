// Plane geometry of the Pro view canvas: rectangles and the camera (pan + cursor-anchored zoom). Pure functions.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Top-left corner and size, in world units. */
export interface Rect extends Point, Size {}

/** The screen area the canvas may use (inside the panels around it). */
export interface Area extends Point, Size {}

/** `screen = world * zoom + (x, y)`. */
export interface Camera extends Point {
  zoom: number;
}

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 2.5;
export const ZOOM_STEP = 1.25;

export const ORIGIN_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export function screenToWorld(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
}

export function worldToScreen(camera: Camera, point: Point): Point {
  return { x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y };
}

export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy };
}

/** Zooms by `factor` keeping the world point under `anchor` (a screen point) where it is. */
export function zoomAt(camera: Camera, factor: number, anchor: Point): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return camera;
  const world = screenToWorld(camera, anchor);
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
}

export function areaCenter(area: Area): Point {
  return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectRight(rect: Rect): number {
  return rect.x + rect.width;
}

export function rectBottom(rect: Rect): number {
  return rect.y + rect.height;
}

export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

export function expandRect(rect: Rect, margin: number): Rect {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + 2 * margin,
    height: rect.height + 2 * margin,
  };
}

/** The smallest rectangle holding all of them; null for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  const first = rects[0];
  if (first === undefined) return null;
  let left = first.x;
  let top = first.y;
  let right = rectRight(first);
  let bottom = rectBottom(first);
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rectRight(rect));
    bottom = Math.max(bottom, rectBottom(rect));
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Whether two rectangles overlap (touching edges do not count; `gap` demands that much free space between them). */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < rectRight(b) + gap && b.x < rectRight(a) + gap && a.y < rectBottom(b) + gap && b.y < rectBottom(a) + gap;
}

/** The part of the world the screen area shows, with `margin` world units around it. */
export function visibleWorldRect(camera: Camera, area: Area, margin = 0): Rect {
  const topLeft = screenToWorld(camera, area);
  return expandRect(
    { x: topLeft.x, y: topLeft.y, width: area.width / camera.zoom, height: area.height / camera.zoom },
    margin,
  );
}

/** Camera that shows all of `bounds` centered in `area`, at most at `maxZoom`. */
export function fitCamera(bounds: Rect, area: Area, padding: number, maxZoom = 1): Camera {
  const availableWidth = Math.max(1, area.width - 2 * padding);
  const availableHeight = Math.max(1, area.height - 2 * padding);
  const zoom = clamp(
    Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)),
    MIN_ZOOM,
    Math.min(maxZoom, MAX_ZOOM),
  );
  return centerCamera(bounds, area, zoom);
}

/** Camera at `zoom` with the center of `rect` at the center of `area`. */
export function centerCamera(rect: Rect, area: Area, zoom: number): Camera {
  const center = rectCenter(rect);
  const target = areaCenter(area);
  return { zoom, x: target.x - center.x * zoom, y: target.y - center.y * zoom };
}

/** Moves the camera as little as needed to bring `rect` inside `area` (keeps the zoom). */
export function revealRect(camera: Camera, rect: Rect, area: Area, padding = 24): Camera {
  const left = rect.x * camera.zoom + camera.x;
  const top = rect.y * camera.zoom + camera.y;
  const right = left + rect.width * camera.zoom;
  const bottom = top + rect.height * camera.zoom;
  let dx = 0;
  let dy = 0;
  if (left < area.x + padding) dx = area.x + padding - left;
  else if (right > area.x + area.width - padding) dx = area.x + area.width - padding - right;
  if (top < area.y + padding) dy = area.y + padding - top;
  else if (bottom > area.y + area.height - padding) dy = area.y + area.height - padding - bottom;
  return dx === 0 && dy === 0 ? camera : panBy(camera, dx, dy);
}

/** Interpolates two cameras; the zoom moves geometrically so the animation feels uniform. */
export function lerpCamera(from: Camera, to: Camera, amount: number): Camera {
  const zoom = from.zoom * Math.pow(to.zoom / from.zoom, amount);
  return { zoom, x: from.x + (to.x - from.x) * amount, y: from.y + (to.y - from.y) * amount };
}

export function sameCamera(a: Camera, b: Camera, epsilon = 0.001): boolean {
  return Math.abs(a.x - b.x) < 0.1 && Math.abs(a.y - b.y) < 0.1 && Math.abs(a.zoom - b.zoom) < epsilon * a.zoom;
}
