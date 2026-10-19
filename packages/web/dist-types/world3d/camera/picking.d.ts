export interface ScreenCapsule {
    id: string;
    /** Feet and head in CSS px. */
    ax: number;
    ay: number;
    bx: number;
    by: number;
    radius: number;
    /** Distance from the camera: nearer wins when capsules overlap. */
    depth: number;
}
/** The nearest capsule under a screen point, or null. */
export declare function pickCapsule(capsules: readonly ScreenCapsule[], px: number, py: number): string | null;
export interface SightTarget {
    id: string;
    x: number;
    y: number;
    z: number;
}
/** The target closest to the view direction within a cone and a maximum distance (first-person "E to open"). */
export declare function targetInSight(eye: {
    x: number;
    y: number;
    z: number;
}, dir: {
    x: number;
    y: number;
    z: number;
}, targets: readonly SightTarget[], maxDistance?: number, coneDegrees?: number): string | null;
