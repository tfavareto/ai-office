// The 2D camera: where the view centre is, how zoomed in it is, and how it eases between states.
import type { ViewInsets } from '../world/api';
import {
  type Anchor,
  type Bounds,
  type Point,
  type Viewport,
  anchoredCenter,
  clampCenter,
  clampZoom,
  easeFactor,
  easeValue,
  easeZoom,
  freeCenter,
  minZoomFor,
  pinnedCenter,
  stepZoom,
  worldAt,
  zoomLevels,
} from './cameraMath';

export * from './cameraMath';

/** Ease rates (1/s): an exponential ease covers about 95% of the way in 3 / rate seconds. */
const POSITION_RATE = 9;
/** Focus/overview moves ease zoom and position together at the same rate so they arrive as one motion. */
const FRAME_RATE = 9;
/** Buttons and keys: ~220 ms to settle. */
const STEP_RATE = 14;
/** Wheel and pinch: tight enough to follow the fingers, loose enough to hide the notches of a mouse wheel. */
const WHEEL_RATE = 18;
const INSET_RATE = 10;
const INSET_SNAP = 0.5;

/**
 * Camera state. `cx, cy` is the world point at the middle of the whole canvas (not of the free area), in world px.
 *
 * Three ways of holding it:
 * - free: the centre is where the user left it (panning, key panning);
 * - anchored: while a wheel zoom eases, the world point under the cursor stays under the cursor;
 * - pinned: a world point (`pin`, a person, a room, the building) is kept in the middle of the free area. The centre
 *   is derived from it every frame with the insets of that frame, so panels opening or closing while the camera
 *   moves cannot leave it off-centre.
 */
export class Camera {
  cx = 0;
  cy = 0;
  zoom = 2;
  /** Zoom the camera is easing toward (equal to `zoom` when settled). */
  tz = 2;
  dpr = 1;
  view: Viewport = { width: 800, height: 600, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  /** Drawn world; the visible rect never leaves it. Null while unknown. */
  world: Bounds | null = null;
  /** World point held in the middle of the free area, and the point it eases toward. */
  pin: Point | null = null;
  pinGoal: Point | null = null;
  private anchor: Anchor | null = null;
  /** Insets the pinned centre is computed with while they ease toward `view.insets`; null when they are the same. */
  private easedInsets: ViewInsets | null = null;
  private zoomRate = FRAME_RATE;

  get levels(): number[] {
    return zoomLevels(this.dpr);
  }

  get minZoom(): number {
    return minZoomFor(this.world, this.view);
  }

  get isPinned(): boolean {
    return this.pin !== null;
  }

  /** True when nothing is easing any more. */
  get settled(): boolean {
    const pinMoving =
      this.pin !== null && this.pinGoal !== null && (this.pin.x !== this.pinGoal.x || this.pin.y !== this.pinGoal.y);
    return this.zoom === this.tz && !pinMoving && this.easedInsets === null;
  }

  /** The view with the insets currently in effect (easing toward the real ones). */
  private effectiveView(): Viewport {
    return this.easedInsets ? { ...this.view, insets: this.easedInsets } : this.view;
  }

  worldToScreen(wx: number, wy: number): Point {
    return {
      x: (wx - this.cx) * this.zoom + this.view.width / 2,
      y: (wy - this.cy) * this.zoom + this.view.height / 2,
    };
  }

  screenToWorld(sx: number, sy: number): Point {
    return worldAt({ x: this.cx, y: this.cy }, this.zoom, this.view, sx, sy);
  }

  /** Visible world rect, for culling. */
  visibleWorld(margin = 0): Bounds {
    const w = this.view.width / this.zoom;
    const h = this.view.height / this.zoom;
    return { x: this.cx - w / 2 - margin, y: this.cy - h / 2 - margin, w: w + margin * 2, h: h + margin * 2 };
  }

  /** World point at the middle of the free area right now. */
  freeCenterWorld(): Point {
    const fc = freeCenter(this.effectiveView());
    return this.screenToWorld(fc.x, fc.y);
  }

  /** Changes the panel insets; a pinned camera eases to the new free area unless `instant`. */
  setInsets(insets: ViewInsets, instant = false): void {
    const previous = this.effectiveView().insets;
    this.view = { ...this.view, insets: { ...insets } };
    this.easedInsets = instant ? null : { ...previous };
  }

  // -------------------------------------------------------------------------------------------------------------
  // commands

  /** Pins `point` in the middle of the free area at `zoom`, easing there (or at once when `instant`). */
  frame(point: Point, zoom: number, instant: boolean): void {
    this.anchor = null;
    this.tz = clampZoom(zoom, this.minZoom);
    this.zoomRate = FRAME_RATE;
    this.pinGoal = { ...point };
    this.pin = instant ? { ...point } : (this.pin ?? this.freeCenterWorld());
    if (!instant) return;
    this.zoom = this.tz;
    this.easedInsets = null;
    this.applyCenter();
  }

  /** Moves the pinned point toward `point` (e.g. a walking person). Pins the current middle first if the camera was free. */
  follow(point: Point): void {
    if (!this.pin) this.pin = this.freeCenterWorld();
    this.pinGoal = { ...point };
  }

  /** Keeps the camera where it is but no longer tied to any world point. */
  release(): void {
    this.pin = null;
    this.pinGoal = null;
  }

  /** Button/key zoom: next level in or out around the middle of the free area (the pinned point stays pinned). */
  step(direction: 1 | -1): void {
    const next = stepZoom(this.levels, this.tz, direction, this.minZoom);
    const fc = freeCenter(this.effectiveView());
    this.setZoomTarget(next, STEP_RATE, fc, true);
  }

  /** Wheel/pinch zoom by `factor` around screen point (sx, sy); with `keepPin` the pinned point stays in the middle instead. */
  zoomBy(factor: number, sx: number, sy: number, keepPin = false): void {
    this.setZoomTarget(this.tz * factor, WHEEL_RATE, { x: sx, y: sy }, keepPin);
  }

  private setZoomTarget(zoom: number, rate: number, at: Point, keepPin: boolean): void {
    this.tz = clampZoom(zoom, this.minZoom);
    this.zoomRate = rate;
    if (this.pin && keepPin) return;
    const w = this.screenToWorld(at.x, at.y);
    this.release();
    this.anchor = { sx: at.x, sy: at.y, wx: w.x, wy: w.y };
  }

  /** Drag: moves the view by a screen delta and lets go of any pinned point. */
  pan(dxScreen: number, dyScreen: number): void {
    this.nudge(-dxScreen / this.zoom, -dyScreen / this.zoom);
  }

  /** Moves the view centre by a world delta and lets go of any pinned point. */
  nudge(dx: number, dy: number): void {
    this.release();
    this.anchor = null;
    this.cx += dx;
    this.cy += dy;
    this.clamp();
  }

  // -------------------------------------------------------------------------------------------------------------
  // per frame

  /** Advances the easing by `dt` seconds (frame-rate independent). Returns true while something is still moving. */
  update(dt: number, reducedMotion = false): boolean {
    const min = this.minZoom;
    this.tz = clampZoom(this.tz, min);
    const k = (rate: number): number => (reducedMotion ? 1 : easeFactor(dt, rate));
    this.zoom = clampZoom(easeZoom(this.zoom, this.tz, k(this.zoomRate)), min);
    this.easeInsets(k(INSET_RATE));
    this.easePin(k(POSITION_RATE));
    this.applyCenter();
    if (this.zoom === this.tz) this.anchor = null;
    return !this.settled;
  }

  private easeInsets(k: number): void {
    const eased = this.easedInsets;
    if (!eased) return;
    const to = this.view.insets;
    const next: ViewInsets = {
      top: easeValue(eased.top, to.top, k, INSET_SNAP),
      right: easeValue(eased.right, to.right, k, INSET_SNAP),
      bottom: easeValue(eased.bottom, to.bottom, k, INSET_SNAP),
      left: easeValue(eased.left, to.left, k, INSET_SNAP),
    };
    const done = next.top === to.top && next.right === to.right && next.bottom === to.bottom && next.left === to.left;
    this.easedInsets = done ? null : next;
  }

  private easePin(k: number): void {
    if (!this.pin || !this.pinGoal) return;
    this.pin = { x: easeValue(this.pin.x, this.pinGoal.x, k), y: easeValue(this.pin.y, this.pinGoal.y, k) };
  }

  /** Derives the view centre from the way the camera is held, then keeps it inside the world. */
  private applyCenter(): void {
    let c: Point = { x: this.cx, y: this.cy };
    if (this.anchor) c = anchoredCenter(this.anchor, this.zoom, this.view);
    else if (this.pin) c = pinnedCenter(this.pin, this.zoom, this.effectiveView());
    this.cx = c.x;
    this.cy = c.y;
    this.clamp();
  }

  /** Keep the visible rect inside the world, whatever the zoom and the window size. */
  clamp(): void {
    this.zoom = clampZoom(this.zoom, this.minZoom);
    const c = clampCenter({ x: this.cx, y: this.cy }, this.zoom, this.view, this.world);
    this.cx = c.x;
    this.cy = c.y;
  }

  /** Snap the drawn centre to the device pixel grid so pixel art does not shimmer. */
  snapped(): Point {
    const scale = this.zoom * this.dpr;
    return { x: Math.round(this.cx * scale) / scale, y: Math.round(this.cy * scale) / scale };
  }
}
