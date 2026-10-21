// One person in the office: a skinned human with procedural pose blending, an account-colour ring and a subagent marker.
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import type { Dir } from '../../layout/types';
import type { Character, SeatKind } from '../../sim/types';
import { Rig } from '../pose/rig';
import { blendFactor, createPose, lerpPose } from '../pose/poseVec';
import { solvePose } from '../pose/poses';
import { TILE_M } from '../units';
import { chooseLook, type LookChoice } from './outfits';
import type { HumanInstance, HumanLibrary } from './humanLibrary';

const YAW: Record<Dir, number> = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const SEAT_HEIGHT: Record<string, number> = {
  desk: 0.47,
  meeting: 0.47,
  stool: 0.65,
  cafe: 0.46,
  sofa: 0.42,
  beanbag: 0.28,
  bench: 0.45,
};
export const ringGeo = new RingGeometry(0.36, 0.43, 40).rotateX(-Math.PI / 2);
const selectGeo = new RingGeometry(0.5, 0.56, 48).rotateX(-Math.PI / 2);
const markerGeo = new OctahedronGeometry(0.07);
const cupGeo = new CylinderGeometry(0.035, 0.028, 0.09, 12);
const cupMat = new MeshBasicMaterial({ color: '#f3efe6' });
const bucketGeo = new CylinderGeometry(0.07, 0.05, 0.14, 12);
const bucketMat = new MeshBasicMaterial({ color: '#d33a3a' });
const bookGeo = new SphereGeometry(0.1, 8, 4).scale(1, 0.12, 0.8);
const bookMat = new MeshBasicMaterial({ color: '#2d4a7a' });

const selectMaterial = new MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  toneMapped: false,
});
const hoverMaterial = new MeshBasicMaterial({
  color: '#ffffff',
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
  toneMapped: false,
});
const markerMaterial = new MeshBasicMaterial({ color: '#b78cff', toneMapped: false });

export interface PersonFrame {
  time: number;
  dt: number;
  accountColor: string;
  detail: boolean;
  selected: boolean;
  hovered: boolean;
  /** prefers-reduced-motion: no pulsing or bobbing. */
  still: boolean;
}

const tmp = new Vector3();

export class Character3D {
  readonly root = new Group();
  readonly choice: LookChoice;
  private readonly instance: HumanInstance;
  private readonly rig: Rig;
  private readonly current = createPose();
  private readonly target = createPose();
  private readonly selectRing: Mesh;
  private readonly marker: Mesh | null;
  private readonly cup: Mesh;
  private readonly bucket: Mesh;
  private readonly book: Mesh;
  private yaw = 0;
  /** Account colour of the ring drawn by the crowd's instanced ring mesh. */
  ringColor = '#8d99ad';
  ringVisible = true;
  private lastX = 0;
  private lastZ = 0;
  private initialised = false;
  private shownDetail = false;

  constructor(
    library: HumanLibrary,
    readonly character: Character,
  ) {
    this.choice = chooseLook(character.look, character.seed);
    this.instance = library.create(this.choice.model, this.choice.outfit);
    this.root.add(this.instance.root);
    this.instance.root.scale.setScalar(this.choice.scale);
    this.rig = new Rig(this.instance.root);
    this.selectRing = new Mesh(selectGeo, selectMaterial);
    this.selectRing.position.y = 0.025;
    this.selectRing.visible = false;
    this.marker = character.kind === 'sub' ? new Mesh(markerGeo, markerMaterial) : null;
    this.cup = new Mesh(cupGeo, cupMat);
    this.bucket = new Mesh(bucketGeo, bucketMat);
    this.book = new Mesh(bookGeo, bookMat);
    for (const p of [this.cup, this.bucket, this.book]) {
      p.visible = false;
      p.castShadow = false;
      this.root.add(p);
    }
    this.root.add(this.selectRing);
    if (this.marker) this.root.add(this.marker);
    this.setDetail(false);
  }

  private setDetail(on: boolean): void {
    if (on === this.shownDetail) return;
    this.shownDetail = on;
    for (const m of this.instance.detail) m.visible = on;
  }

  update(c: Character, f: PersonFrame): void {
    const x = c.x * TILE_M;
    const z = c.y * TILE_M;
    this.root.position.set(x, 0, z);
    this.root.visible = c.alpha > 0.12;
    this.ringVisible = false;
    if (!this.root.visible) return;
    this.updateYaw(c, x, z, f.dt);
    this.root.rotation.y = this.yaw;
    this.updatePose(c, f);
    this.updateAccessories(c, f);
    this.setDetail(f.detail);
  }

  private updateYaw(c: Character, x: number, z: number, dt: number): void {
    let goal = YAW[c.dir];
    if (this.initialised && c.moving) {
      const dx = x - this.lastX;
      const dz = z - this.lastZ;
      if (dx * dx + dz * dz > 1e-7) goal = Math.atan2(dx, dz);
    }
    if (!this.initialised) {
      this.yaw = goal;
      this.initialised = true;
    }
    let diff = goal - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * (c.moving ? 12 : 9));
    this.lastX = x;
    this.lastZ = z;
  }

  private updatePose(c: Character, f: PersonFrame): void {
    const seated = c.seat !== null;
    solvePose(this.target, c.pose, {
      t: c.poseT,
      walk: c.walkPhase,
      phase: this.choice.phase * 6.28,
      pelvisRest: this.rig.pelvisRestY,
      seated,
      seatHeight: seatHeightOf(c.seat),
      shellStage: c.shellStage,
    });
    const rate = c.pose === 'walk' ? 16 : 9;
    lerpPose(this.current, this.current, this.target, this.firstFrame() ? 1 : blendFactor(rate, f.dt));
    this.rig.apply(this.current);
  }

  private frames = 0;
  private firstFrame(): boolean {
    return this.frames++ === 0;
  }

  private updateAccessories(c: Character, f: PersonFrame): void {
    this.ringColor = f.accountColor;
    this.ringVisible = c.alpha > 0.5;
    this.selectRing.visible = f.selected || f.hovered;
    if (this.selectRing.visible) {
      this.selectRing.material = f.selected ? selectMaterial : hoverMaterial;
      this.selectRing.scale.setScalar(f.selected && !f.still ? 1 + Math.sin(f.time * 4) * 0.04 : 1);
    }
    if (this.marker) {
      this.marker.position.set(
        0,
        2.05 * this.choice.scale + (f.still ? 0 : Math.sin(f.time * 2 + this.choice.phase * 6) * 0.03),
        0,
      );
      this.marker.rotation.y = f.still ? 0 : f.time * 1.5;
    }
    this.cup.visible = c.carrying === 'cup';
    this.bucket.visible = c.pose === 'popcorn';
    this.book.visible = c.pose === 'read';
    if (this.cup.visible) this.attach(this.cup, 'hand_r', 0.02, 0.0, 0.04);
    if (this.bucket.visible) this.attach(this.bucket, 'hand_l', 0.0, 0.0, 0.06);
    if (this.book.visible) this.attach(this.book, 'hand_l', 0.05, 0.0, 0.08);
  }

  /** Keeps a prop upright at a hand bone (props live on the root, not on the bone, to avoid bone roll). */
  private attach(prop: Mesh, bone: 'hand_l' | 'hand_r', ox: number, oy: number, oz: number): void {
    const b = this.rig.bone(bone);
    b.getWorldPosition(tmp);
    this.root.worldToLocal(tmp);
    prop.position.set(tmp.x + ox, tmp.y + oy, tmp.z + oz);
  }

  /** World position of the top of the head (name tags, bubbles). */
  headTop(out: Vector3): Vector3 {
    this.rig.bone('head').getWorldPosition(out);
    out.y += 0.2 * this.choice.scale;
    return out;
  }

  headWorld(out: Vector3): Vector3 {
    return this.rig.bone('head').getWorldPosition(out);
  }

  /** Material swap hook used by the portrait renderer. */
  materials(): Material[] {
    return this.instance.meshes.map((m) => m.material as Material);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

export function seatHeightOf(seat: SeatKind): number {
  return seat ? (SEAT_HEIGHT[seat] ?? 0.45) : 0.47;
}
