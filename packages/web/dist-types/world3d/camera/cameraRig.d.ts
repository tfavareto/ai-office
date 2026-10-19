import { OrthographicCamera, PerspectiveCamera, Raycaster, Vector3, type Camera } from 'three';
import type { CameraMode, ViewInsets } from '../../world/api';
import { type Basis, type Box3Like, type IsoState, type View } from './isoCamera';
import { type WalkerState } from './walker';
export declare class CameraRig {
    readonly ortho: OrthographicCamera;
    readonly persp: PerspectiveCamera;
    mode: CameraMode;
    readonly basis: Basis;
    view: View;
    iso: IsoState;
    goal: IsoState;
    walker: WalkerState;
    /** Orbit offsets of the shoulder camera set by dragging. */
    shoulderYaw: number;
    shoulderDistance: number;
    private shoulderPos;
    private shoulderLook;
    private shoulderInit;
    private readonly raycaster;
    private readonly tmp;
    constructor();
    get active(): Camera;
    resize(width: number, height: number, insets: ViewInsets): void;
    /** Zoom/target that fit a box in the free rectangle. */
    fitFor(box: Box3Like, margin?: number): IsoState;
    fit(box: Box3Like, immediate: boolean, margin?: number): void;
    pan(dx: number, dy: number): void;
    zoomAtScreen(factor: number, sx: number, sy: number): void;
    focusGround(x: number, z: number, zoom?: number, immediate?: boolean): void;
    setShoulder(position: Vector3, look: Vector3): void;
    private shoulderGoalPos;
    private shoulderGoalLook;
    resetShoulder(): void;
    update(dt: number, reducedMotion: boolean): void;
    private applyIso;
    private applyFirstPerson;
    private applyShoulder;
    /** Camera position for the shoulder view of a person at (x, z) facing `yaw`. */
    shoulderFor(x: number, z: number, yaw: number, out: {
        position: Vector3;
        look: Vector3;
    }): void;
    look(dyaw: number, dpitch: number): void;
    /** Screen position (CSS px, relative to the view) of a world point, plus its distance for depth ordering. */
    project(world: Vector3, out: {
        x: number;
        y: number;
        depth: number;
        visible: boolean;
    }): void;
    /** Ray through a screen point. */
    rayAt(sx: number, sy: number): Raycaster;
    /** Metres per CSS pixel at the target (labels use it to decide detail). */
    get zoom(): number;
}
