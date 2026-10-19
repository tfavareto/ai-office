// Pure camera math for the 2D world. World units are pixels at zoom 1 (1 tile = 16 px); screen units are CSS px.
import type { ViewInsets } from '../world/api';

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  width: number;
  height: number;
  insets: ViewInsets;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 6;
const BASE_LEVELS = [0.5, 1, 1.5, 2, 3, 4, 5, 6];

/** Zoom levels whose device scale (zoom x DPR) is a whole number, so pixels stay perfectly square. */
export function zoomLevels(dpr: number): number[] {
  const levels = BASE_LEVELS.filter((z) => Math.abs(z * dpr - Math.round(z * dpr)) < 1e-6 || z === MIN_ZOOM);
  return levels.length ? levels : [1, 2, 3, 4, 5, 6];
}

export function nearestLevel(levels: readonly number[], zoom: number): number {
  return levels.reduce((best, z) => (Math.abs(z - zoom) < Math.abs(best - zoom) ? z : best), levels[0]);
}

export function stepLevel(levels: readonly number[], zoom: number, direction: 1 | -1): number {
  const index = levels.indexOf(nearestLevel(levels, zoom));
  return levels[Math.min(levels.length - 1, Math.max(0, index + direction))];
}

/** Centre of the free area (not covered by panels), in screen px. */
export function freeCenter(view: Viewport): { x: number; y: number } {
  const { insets } = view;
  return {
    x: insets.left + (view.width - insets.left - insets.right) / 2,
    y: insets.top + (view.height - insets.top - insets.bottom) / 2,
  };
}

/** Largest zoom level that still fits `bounds` inside the free area (or the exact fit when even the smallest level overflows). */
export function fitZoom(bounds: Bounds, view: Viewport, levels: readonly number[]): number {
  const freeW = Math.max(40, view.width - view.insets.left - view.insets.right);
  const freeH = Math.max(40, view.height - view.insets.top - view.insets.bottom);
  const fit = Math.min(freeW / bounds.w, freeH / bounds.h);
  const fitting = levels.filter((z) => z <= fit + 1e-9);
  return fitting.length ? fitting[fitting.length - 1] : Math.max(0.05, fit);
}

export class Camera {
  /** Current and target centre in world px. */
  cx = 0;
  cy = 0;
  tx = 0;
  ty = 0;
  zoom = 2;
  dpr = 1;
  view: Viewport = { width: 800, height: 600, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  /** World area the camera centre may not leave. */
  limits: Bounds = { x: -1e5, y: -1e5, w: 2e5, h: 2e5 };

  get levels(): number[] {
    return zoomLevels(this.dpr);
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.cx) * this.zoom + this.view.width / 2,
      y: (wy - this.cy) * this.zoom + this.view.height / 2,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.view.width / 2) / this.zoom + this.cx,
      y: (sy - this.view.height / 2) / this.zoom + this.cy,
    };
  }

  /** Visible world rect, for culling. */
  visibleWorld(margin = 0): Bounds {
    const w = this.view.width / this.zoom;
    const h = this.view.height / this.zoom;
    return { x: this.cx - w / 2 - margin, y: this.cy - h / 2 - margin, w: w + margin * 2, h: h + margin * 2 };
  }

  /** Zoom one level in/out keeping the world point under (sx, sy) fixed on screen. */
  zoomAt(direction: 1 | -1, sx: number, sy: number): void {
    const next = stepLevel(this.levels, this.zoom, direction);
    if (next === this.zoom) return;
    const anchor = this.screenToWorld(sx, sy);
    const before = { x: this.cx, y: this.cy };
    this.zoom = next;
    this.cx = anchor.x - (sx - this.view.width / 2) / next;
    this.cy = anchor.y - (sy - this.view.height / 2) / next;
    this.retarget(before);
    this.clamp();
  }

  setZoom(zoom: number): void {
    const fc = freeCenter(this.view);
    const anchor = this.screenToWorld(fc.x, fc.y);
    const before = { x: this.cx, y: this.cy };
    this.zoom = zoom;
    this.cx = anchor.x - (fc.x - this.view.width / 2) / zoom;
    this.cy = anchor.y - (fc.y - this.view.height / 2) / zoom;
    this.retarget(before);
    this.clamp();
  }

  /** After a zoom: a settled camera keeps following its centre, a camera easing toward a target keeps that target. */
  private retarget(before: { x: number; y: number }): void {
    if (Math.abs(this.tx - before.x) < 1e-6 && Math.abs(this.ty - before.y) < 1e-6) {
      this.tx = this.cx;
      this.ty = this.cy;
    }
  }

  /** Centre target so that world point (wx, wy) lands in the middle of the free area. */
  focusTarget(wx: number, wy: number): { x: number; y: number } {
    const fc = freeCenter(this.view);
    return { x: wx - (fc.x - this.view.width / 2) / this.zoom, y: wy - (fc.y - this.view.height / 2) / this.zoom };
  }

  focus(wx: number, wy: number, instant = false): void {
    const t = this.focusTarget(wx, wy);
    this.tx = t.x;
    this.ty = t.y;
    if (instant) {
      this.cx = t.x;
      this.cy = t.y;
    }
  }

  /** Zoom to fit `bounds` in the free area and centre them. */
  fit(bounds: Bounds, instant = false): void {
    this.zoom = fitZoom(bounds, this.view, this.levels);
    this.focus(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, instant);
  }

  pan(dxScreen: number, dyScreen: number): void {
    this.cx -= dxScreen / this.zoom;
    this.cy -= dyScreen / this.zoom;
    this.tx = this.cx;
    this.ty = this.cy;
    this.clamp();
  }

  /** Ease the centre toward its target (frame-rate independent). Returns true while still moving. */
  update(dt: number, stiffness = 9): boolean {
    const k = 1 - Math.exp(-dt * stiffness);
    const dx = this.tx - this.cx;
    const dy = this.ty - this.cy;
    if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) {
      this.cx = this.tx;
      this.cy = this.ty;
      return false;
    }
    this.cx += dx * k;
    this.cy += dy * k;
    return true;
  }

  /** Keep the view centre inside the limits so the world cannot be lost off-screen. */
  clamp(): void {
    const { x, y, w, h } = this.limits;
    this.cx = Math.min(x + w, Math.max(x, this.cx));
    this.cy = Math.min(y + h, Math.max(y, this.cy));
    this.tx = Math.min(x + w, Math.max(x, this.tx));
    this.ty = Math.min(y + h, Math.max(y, this.ty));
  }

  /** Snap the drawn centre to the device pixel grid so pixel art does not shimmer. */
  snapped(): { x: number; y: number } {
    const scale = this.zoom * this.dpr;
    return { x: Math.round(this.cx * scale) / scale, y: Math.round(this.cy * scale) / scale };
  }
}
