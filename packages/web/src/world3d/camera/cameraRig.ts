// The camera: isometric orthographic overview (pan / zoom / fit / focus), first person and over-the-shoulder, all with
// the same projection helpers for labels and picking.
import { OrthographicCamera, PerspectiveCamera, Raycaster, Vector2, Vector3, type Camera } from 'three';
import type { CameraMode, ViewInsets } from '../../world/api';
import { EYE_H } from '../units';
import {
  approachState, boxCorners, fitPoints, frustumFor, isoBasis, panBy, zoomAt, MAX_ZOOM, MIN_ZOOM, type Basis, type Box3Like, type IsoState, type View,
} from './isoCamera';
import { clampPitch, type WalkerState } from './walker';

const ISO_DISTANCE = 130;
const FOLLOW_RATE = 7;
const FP_FOV = 74;
const SHOULDER_FOV = 52;
const SHOULDER_BACK = 1.55;
const SHOULDER_UP = 1.85;
const SHOULDER_SIDE = 0.38;

export class CameraRig {
  readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 1, 420);
  readonly persp = new PerspectiveCamera(FP_FOV, 1, 0.05, 600);
  mode: CameraMode = 'overview';
  readonly basis: Basis = isoBasis();
  view: View = { width: 1, height: 1, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  iso: IsoState = { target: { x: 20, z: 10 }, zoom: 20 };
  goal: IsoState = { target: { x: 20, z: 10 }, zoom: 20 };
  walker: WalkerState = { x: 6, z: 8, yaw: 0, pitch: 0 };
  /** Orbit offsets of the shoulder camera set by dragging. */
  shoulderYaw = 0;
  shoulderDistance = 1;
  private shoulderPos = new Vector3();
  private shoulderLook = new Vector3();
  private shoulderInit = false;
  private readonly raycaster = new Raycaster();
  private readonly tmp = new Vector3();

  constructor() {
    this.ortho.up.set(0, 1, 0);
  }

  get active(): Camera {
    return this.mode === 'overview' ? this.ortho : this.persp;
  }

  resize(width: number, height: number, insets: ViewInsets): void {
    this.view = { width, height, insets };
    this.persp.aspect = width / Math.max(1, height);
    this.persp.updateProjectionMatrix();
  }

  /** Zoom/target that fit a box in the free rectangle. */
  fitFor(box: Box3Like, margin = 28): IsoState {
    return fitPoints(boxCorners(box), this.basis, this.view, margin);
  }

  fit(box: Box3Like, immediate: boolean, margin = 28): void {
    this.goal = this.fitFor(box, margin);
    if (immediate) this.iso = this.goal;
  }

  pan(dx: number, dy: number): void {
    this.iso = panBy(this.iso, this.basis, dx, dy);
    this.goal = this.iso;
  }

  zoomAtScreen(factor: number, sx: number, sy: number): void {
    const next = zoomAt(this.goal, this.basis, this.view, factor, sx, sy, MIN_ZOOM, MAX_ZOOM);
    this.goal = next;
  }

  focusGround(x: number, z: number, zoom?: number, immediate = false): void {
    this.goal = { target: { x, z }, zoom: zoom ?? this.goal.zoom };
    if (immediate) this.iso = this.goal;
  }

  setShoulder(position: Vector3, look: Vector3): void {
    if (!this.shoulderInit) {
      this.shoulderPos.copy(position);
      this.shoulderLook.copy(look);
      this.shoulderInit = true;
    }
    this.shoulderGoalPos = position;
    this.shoulderGoalLook = look;
  }

  private shoulderGoalPos = new Vector3();
  private shoulderGoalLook = new Vector3();

  resetShoulder(): void {
    this.shoulderInit = false;
  }

  update(dt: number, reducedMotion: boolean): void {
    if (this.mode === 'overview') {
      this.iso = approachState(this.iso, this.goal, reducedMotion ? 40 : FOLLOW_RATE, dt);
      this.applyIso();
    } else if (this.mode === 'first-person') {
      this.applyFirstPerson();
    } else {
      this.applyShoulder(dt);
    }
  }

  private applyIso(): void {
    const { target } = this.iso;
    const f = frustumFor(this.iso, this.view);
    const cam = this.ortho;
    cam.left = f.left;
    cam.right = f.right;
    cam.top = f.top;
    cam.bottom = f.bottom;
    cam.position.set(target.x + this.basis.back[0] * ISO_DISTANCE, this.basis.back[1] * ISO_DISTANCE, target.z + this.basis.back[2] * ISO_DISTANCE);
    cam.lookAt(target.x, 0, target.z);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  private applyFirstPerson(): void {
    const { x, z, yaw, pitch } = this.walker;
    const cam = this.persp;
    cam.fov = FP_FOV;
    cam.position.set(x, EYE_H, z);
    cam.lookAt(x + Math.sin(yaw) * Math.cos(pitch), EYE_H + Math.sin(pitch), z + Math.cos(yaw) * Math.cos(pitch));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  private applyShoulder(dt: number): void {
    const k = 1 - Math.exp(-dt * 8);
    this.shoulderPos.lerp(this.shoulderGoalPos, k);
    this.shoulderLook.lerp(this.shoulderGoalLook, k);
    const cam = this.persp;
    cam.fov = SHOULDER_FOV;
    cam.position.copy(this.shoulderPos);
    cam.lookAt(this.shoulderLook);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  /** Camera position for the shoulder view of a person at (x, z) facing `yaw`. */
  shoulderFor(x: number, z: number, yaw: number, out: { position: Vector3; look: Vector3 }): void {
    const a = yaw + this.shoulderYaw;
    const back = SHOULDER_BACK * this.shoulderDistance;
    out.position.set(x - Math.sin(a) * back + Math.cos(a) * SHOULDER_SIDE, SHOULDER_UP, z - Math.cos(a) * back - Math.sin(a) * SHOULDER_SIDE);
    out.look.set(x + Math.sin(a) * 1.4, 1.35, z + Math.cos(a) * 1.4);
  }

  look(dyaw: number, dpitch: number): void {
    this.walker = { ...this.walker, yaw: this.walker.yaw + dyaw, pitch: clampPitch(this.walker.pitch + dpitch) };
  }

  /** Screen position (CSS px, relative to the view) of a world point, plus its distance for depth ordering. */
  project(world: Vector3, out: { x: number; y: number; depth: number; visible: boolean }): void {
    const cam = this.active;
    this.tmp.copy(world).project(cam);
    out.x = ((this.tmp.x + 1) / 2) * this.view.width;
    out.y = ((1 - this.tmp.y) / 2) * this.view.height;
    out.depth = world.distanceTo(cam.position);
    out.visible = this.tmp.z > -1 && this.tmp.z < 1;
  }

  /** Ray through a screen point. */
  rayAt(sx: number, sy: number): Raycaster {
    const ndc = new Vector2((sx / this.view.width) * 2 - 1, -(sy / this.view.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.active);
    return this.raycaster;
  }

  /** Metres per CSS pixel at the target (labels use it to decide detail). */
  get zoom(): number {
    return this.iso.zoom;
  }
}
