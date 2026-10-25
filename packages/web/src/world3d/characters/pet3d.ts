// The office cat in 3D: a handful of primitives with a small rig (body, head, tail, four legs) driven by the same pet
// logic as the 2D cat. Walks with alternating legs, sits, grooms and sleeps curled up.
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import type { Dir } from '../../layout/types';
import type { PetPose } from '../../world/pet';
import { TILE_M } from '../units';

const FUR = '#e08a3c';
const STRIPE = '#a85a1a';
const BELLY = '#f6e3c8';
const YAW: Record<Dir, number> = { e: 0, s: -Math.PI / 2, w: Math.PI, n: Math.PI / 2 };
const TURN_RATE = 9;
/** Nose to tail root, in metres: a bit more than a cat, so it reads from the iso camera. */
const BODY_LENGTH = 0.5;

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export class PetModel3D {
  readonly group = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly tail = new Group();
  private readonly legs: Group[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private yaw = 0;
  private placed = false;

  constructor() {
    const fur = this.material(FUR);
    const dark = this.material(STRIPE);
    const light = this.material(BELLY);
    const eye = this.material('#1a1410');
    const nose = this.material('#e87a8a');

    const torso = this.mesh(new SphereGeometry(0.1, 14, 10), fur);
    torso.scale.set(1.7, 0.95, 0.9);
    this.body.add(torso);
    for (const x of [-0.07, 0.0, 0.07]) {
      const stripe = this.mesh(new BoxGeometry(0.02, 0.012, 0.15), dark);
      stripe.position.set(x, 0.094, 0);
      this.body.add(stripe);
    }
    const belly = this.mesh(new SphereGeometry(0.07, 10, 8), light);
    belly.scale.set(1.8, 0.5, 0.8);
    belly.position.set(0, -0.055, 0);
    this.body.add(belly);

    const skull = this.mesh(new SphereGeometry(0.07, 12, 10), fur);
    skull.scale.set(1, 0.95, 1.05);
    this.head.add(skull);
    for (const z of [-0.04, 0.04]) {
      const ear = this.mesh(new ConeGeometry(0.026, 0.05, 6), fur);
      ear.position.set(-0.005, 0.07, z);
      this.head.add(ear);
      const pupil = this.mesh(new SphereGeometry(0.011, 6, 5), eye);
      pupil.position.set(0.058, 0.012, z * 0.85);
      this.head.add(pupil);
    }
    const snout = this.mesh(new SphereGeometry(0.022, 8, 6), light);
    snout.position.set(0.064, -0.018, 0);
    this.head.add(snout);
    const tip = this.mesh(new SphereGeometry(0.008, 6, 5), nose);
    tip.position.set(0.082, -0.008, 0);
    this.head.add(tip);
    this.head.position.set(0.15, 0.1, 0);
    this.body.add(this.head);

    const tailMesh = this.mesh(new CylinderGeometry(0.014, 0.02, 0.26, 8), fur);
    tailMesh.position.set(0, 0.12, 0);
    const tailTip = this.mesh(new SphereGeometry(0.016, 6, 5), dark);
    tailTip.position.set(0, 0.26, 0);
    this.tail.add(tailMesh, tailTip);
    this.tail.position.set(-0.17, 0.02, 0);
    this.tail.rotation.z = Math.PI / 2.8;
    this.body.add(this.tail);

    const legGeometry = new CylinderGeometry(0.016, 0.014, 0.1, 6);
    this.geometries.push(legGeometry);
    for (const [x, z] of [
      [0.1, 0.05],
      [0.1, -0.05],
      [-0.1, 0.05],
      [-0.1, -0.05],
    ] as const) {
      const leg = new Group();
      const bone = new Mesh(legGeometry, fur);
      bone.position.y = -0.05;
      bone.castShadow = true;
      leg.add(bone);
      leg.position.set(x, -0.03, z);
      this.legs.push(leg);
      this.group.add(leg);
    }
    this.body.position.y = 0.16;
    this.group.add(this.body);
    this.group.scale.setScalar(BODY_LENGTH / 0.34);
    this.group.visible = false;
  }

  private material(color: string): MeshStandardMaterial {
    const material = new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 });
    this.materials.push(material);
    return material;
  }

  private mesh(geometry: BufferGeometry, material: Material): Mesh {
    this.geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    return mesh;
  }

  /** Puts the cat in its pose. `time` is the animation clock in seconds. */
  update(pose: PetPose, dt: number, time: number): void {
    this.group.visible = true;
    this.group.position.set(pose.x * TILE_M, 0, pose.y * TILE_M);
    const target = YAW[pose.dir];
    if (!this.placed) {
      this.yaw = target;
      this.placed = true;
    } else this.yaw += angleDelta(this.yaw, target) * Math.min(1, dt * TURN_RATE);
    this.group.rotation.y = this.yaw;

    const swing = Math.sin(pose.phase * Math.PI * 2);
    const walking = pose.mode === 'walk';
    this.legs.forEach((leg, index) => {
      const sign = index === 0 || index === 3 ? 1 : -1;
      leg.visible = pose.mode !== 'sleep';
      leg.rotation.z = walking ? swing * 0.7 * sign : 0;
      leg.scale.y = pose.mode === 'sit' || pose.mode === 'groom' ? (index < 2 ? 1 : 0.55) : 1;
    });
    this.tail.rotation.z =
      Math.PI / 2.8 + (walking ? Math.sin(pose.phase * Math.PI * 4) * 0.12 : Math.sin(time * 1.3) * 0.1);
    this.tail.rotation.x = pose.mode === 'sleep' ? 1.1 : 0;

    switch (pose.mode) {
      case 'walk':
        this.body.position.y = 0.16 + Math.abs(swing) * 0.012;
        this.body.rotation.z = 0;
        this.head.rotation.z = 0;
        this.head.position.set(0.15, 0.1, 0);
        break;
      case 'sit':
      case 'groom': {
        this.body.position.y = 0.11;
        this.body.rotation.z = 0.55;
        const bob = pose.mode === 'groom' ? Math.sin(time * 9) * 0.25 - 0.45 : Math.sin(time * 0.9) * 0.03;
        this.head.rotation.z = -0.55 + bob;
        this.head.position.set(0.15, 0.11, 0);
        break;
      }
      case 'sleep': {
        this.body.position.y = 0.075 + Math.sin(time * 1.6) * 0.004;
        this.body.rotation.z = 0;
        this.head.rotation.z = -0.5;
        this.head.position.set(0.12, 0.0, 0.05);
        this.body.scale.set(1, 0.78, 1.15);
        return;
      }
    }
    this.body.scale.set(1, 1, 1);
  }

  hide(): void {
    this.group.visible = false;
    this.placed = false;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
