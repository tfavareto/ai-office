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
/** Smallest zoom the overview may pick on a tiny window; wheel/+/- steps never go below the first level. */
export declare const MIN_FIT_ZOOM = 0.25;
export declare const MIN_ZOOM = 0.5;
export declare const MAX_ZOOM = 6;
/** Zoom levels whose device scale (zoom x DPR) is a whole number, so pixels stay perfectly square. */
export declare function zoomLevels(dpr: number): number[];
export declare function nearestLevel(levels: readonly number[], zoom: number): number;
/** Next level in/out from any zoom (the overview zoom is usually between two levels). Stays put at the ends. */
export declare function stepLevel(levels: readonly number[], zoom: number, direction: 1 | -1): number;
/** Centre of the free area (not covered by panels), in screen px. */
export declare function freeCenter(view: Viewport): {
    x: number;
    y: number;
};
/** Largest zoom level that still fits `bounds` inside the free area (or the exact fit when even the smallest level overflows). */
export declare function fitZoom(bounds: Bounds, view: Viewport, levels: readonly number[]): number;
/** Exact (continuous) zoom at which `bounds` plus `pad` CSS px on every side fills the free area. */
export declare function fitContinuous(bounds: Bounds, view: Viewport, pad?: number): number;
/**
 * Zoom of the overview: the whole `building` (world px, origin at 0,0) inside the free area with a small margin.
 * A whole device-pixel scale (crisp pixel art) is used when it fits and wastes little; otherwise the exact
 * continuous fit, so any window size from tiny to ultra-wide shows the complete building.
 */
export declare function overviewZoom(building: {
    w: number;
    h: number;
}, view: Viewport, dpr: number): number;
export declare class Camera {
    /** Current and target centre in world px. */
    cx: number;
    cy: number;
    tx: number;
    ty: number;
    zoom: number;
    /** Zoom the camera is easing toward (null when settled). */
    tz: number | null;
    dpr: number;
    view: Viewport;
    /** World area the camera centre may not leave. */
    limits: Bounds;
    get levels(): number[];
    worldToScreen(wx: number, wy: number): {
        x: number;
        y: number;
    };
    screenToWorld(sx: number, sy: number): {
        x: number;
        y: number;
    };
    /** Visible world rect, for culling. */
    visibleWorld(margin?: number): Bounds;
    /** Zoom one level in/out keeping the world point under (sx, sy) fixed on screen. */
    zoomAt(direction: 1 | -1, sx: number, sy: number): void;
    setZoom(zoom: number): void;
    /** After a zoom: a settled camera keeps following its centre, a camera easing toward a target keeps that target. */
    private retarget;
    /** Centre target so that world point (wx, wy) lands in the middle of the free area. */
    focusTarget(wx: number, wy: number): {
        x: number;
        y: number;
    };
    focus(wx: number, wy: number, instant?: boolean): void;
    /** Zoom to the largest level that fits `bounds` in the free area and centre them. */
    fit(bounds: Bounds, instant?: boolean): void;
    /** Zoom to an exact value (instantly, or eased together with the centre target). */
    zoomTo(zoom: number, instant: boolean): void;
    /** Centre `centre` (world px) in the free area at an exact zoom. */
    frame(centre: {
        x: number;
        y: number;
    }, zoom: number, instant: boolean): void;
    pan(dxScreen: number, dyScreen: number): void;
    /** Ease the centre toward its target (frame-rate independent). Returns true while still moving. */
    update(dt: number, stiffness?: number): boolean;
    /** Keep the view centre inside the limits so the world cannot be lost off-screen. */
    clamp(): void;
    /** Snap the drawn centre to the device pixel grid so pixel art does not shimmer. */
    snapped(): {
        x: number;
        y: number;
    };
}
