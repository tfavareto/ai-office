export interface View {
    width: number;
    height: number;
    insets: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
}
export interface Basis {
    right: readonly [number, number, number];
    up: readonly [number, number, number];
    /** Unit vector from the target towards the camera. */
    back: readonly [number, number, number];
}
export declare const ISO_AZIMUTH: number;
export declare const ISO_PITCH: number;
export declare const MIN_ZOOM = 5;
export declare const MAX_ZOOM = 190;
/** Orthonormal camera basis for an azimuth (0 = looking north from the south) and a pitch above the horizon. */
export declare function isoBasis(azimuth?: number, pitch?: number): Basis;
export interface GroundPoint {
    x: number;
    z: number;
}
/** The free rectangle (CSS px) not covered by panels. */
export declare function freeRect(view: View): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** Ground displacement (y = 0) whose projection on the view axes is (u, v) metres. */
export declare function groundFromView(basis: Basis, u: number, v: number): GroundPoint;
export interface IsoState {
    /** Ground point (y = 0) shown at the centre of the free rectangle. */
    target: GroundPoint;
    /** Pixels per metre. */
    zoom: number;
}
/** Ground point under a screen position. */
export declare function screenToGround(state: IsoState, basis: Basis, view: View, sx: number, sy: number): GroundPoint;
/** Screen position (CSS px) of a world point. */
export declare function worldToScreen(state: IsoState, basis: Basis, view: View, p: {
    x: number;
    y: number;
    z: number;
}): {
    x: number;
    y: number;
};
/** Moves the target so the scene follows a pointer drag of (dx, dy) pixels. */
export declare function panBy(state: IsoState, basis: Basis, dx: number, dy: number): IsoState;
export declare const clampZoom: (zoom: number, min?: number, max?: number) => number;
/** Zooms by a factor keeping the ground point under (sx, sy) fixed. */
export declare function zoomAt(state: IsoState, basis: Basis, view: View, factor: number, sx: number, sy: number, min?: number, max?: number): IsoState;
export interface Box3Like {
    min: {
        x: number;
        y: number;
        z: number;
    };
    max: {
        x: number;
        y: number;
        z: number;
    };
}
export declare function boxCorners(box: Box3Like): {
    x: number;
    y: number;
    z: number;
}[];
/** Zoom and target that fit the points inside the free rectangle (with a margin in pixels). */
export declare function fitPoints(points: readonly {
    x: number;
    y: number;
    z: number;
}[], basis: Basis, view: View, marginPx?: number, min?: number, max?: number): IsoState;
/** Frustum extents (metres, relative to the camera) so that the target lands in the centre of the free rectangle. */
export declare function frustumFor(state: IsoState, view: View): {
    left: number;
    right: number;
    top: number;
    bottom: number;
};
/** Exponential smoothing factor for a frame (rate in 1/s). */
export declare const smoothing: (rate: number, dt: number) => number;
export declare function approachState(current: IsoState, goal: IsoState, rate: number, dt: number): IsoState;
