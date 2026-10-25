// Confetti for the 3D world: one instanced mesh of small flat quads, a fixed pool and simple physics on the CPU
// (gravity, drag, flutter, a floor). Same feel as the 2D pixel confetti: same palette, bursts and showers.
import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { Rng } from '../../layout/rng';
import type { SimEffect, TileRect } from '../../sim/effects';
import { CONFETTI_COLORS } from '../../world2d/fx/confetti';
import { TILE_M } from '../units';

const CAPACITY = 1500;
const GRAVITY = 5.2;
const DRAG = 1.5;
const MIN_LIFE = 1.5;
const MAX_LIFE = 2.5;
const SHRINK_SECONDS = 0.45;
const BURST_BASE = 110;
const BIG_BONUS = 1.5;
const BURST_HEIGHT = 1.25;
const SHOWER_SECONDS = 2.8;
const SHOWER_PER_SECOND = 170;
const SHOWER_HEIGHT = 3.3;
const MAX_EMITTERS = 4;

interface Emitter {
  rect: { x: number; z: number; w: number; d: number };
  left: number;
  carry: number;
  scale: number;
  rng: Rng;
}

const colors = CONFETTI_COLORS.map((c) => new Color(c));
const scratchM = new Matrix4();
const scratchQ = new Quaternion();
const scratchE = new Euler();
const scratchP = new Vector3();
const scratchS = new Vector3();

export class Confetti3D {
  readonly group = new Group();
  private readonly mesh: InstancedMesh;
  private readonly pos = new Float32Array(CAPACITY * 3);
  private readonly vel = new Float32Array(CAPACITY * 3);
  private readonly rot = new Float32Array(CAPACITY * 3);
  private readonly spin = new Float32Array(CAPACITY * 3);
  private readonly life = new Float32Array(CAPACITY);
  private readonly maxLife = new Float32Array(CAPACITY);
  private readonly tint = new Uint8Array(CAPACITY);
  private readonly phase = new Float32Array(CAPACITY);
  private readonly scale = new Float32Array(CAPACITY);
  private cursor = 0;
  private alive = 0;
  private emitters: Emitter[] = [];

  constructor() {
    const material = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
    this.mesh = new InstancedMesh(new PlaneGeometry(0.11, 0.066), material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 10;
    this.mesh.setColorAt(0, colors[0] as Color);
    this.group.add(this.mesh);
  }

  get count(): number {
    return this.alive;
  }

  get busy(): boolean {
    return this.alive > 0 || this.emitters.length > 0;
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
    this.emitters = [];
    this.mesh.count = 0;
  }

  apply(effect: SimEffect): void {
    if (effect.type === 'burst')
      this.burst(effect.x * TILE_M, effect.y * TILE_M, effect.scale, effect.big, effect.seed);
    else if (effect.type === 'shower') this.shower(effect.rect, effect.scale, effect.seed);
    else if (effect.type === 'spark') this.sparks(effect.x * TILE_M, effect.y * TILE_M, effect.seed);
  }

  private take(): number {
    for (let n = 0; n < CAPACITY; n++) {
      const i = (this.cursor + n) % CAPACITY;
      if ((this.life[i] as number) <= 0) {
        this.cursor = (i + 1) % CAPACITY;
        this.alive++;
        return i;
      }
    }
    const i = this.cursor;
    this.cursor = (i + 1) % CAPACITY;
    return i;
  }

  private emit(rng: Rng, p: Vector3, vx: number, vy: number, vz: number, life: number, size: number): void {
    const i = this.take();
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    for (let k = 0; k < 3; k++) {
      this.rot[i * 3 + k] = rng.range(0, 6.28);
      this.spin[i * 3 + k] = rng.range(-10, 10);
    }
    this.life[i] = life;
    this.maxLife[i] = life;
    this.tint[i] = rng.int(colors.length);
    this.phase[i] = rng.range(0, 6.28);
    this.scale[i] = size;
  }

  /** From a person standing at (x, z) metres. */
  burst(x: number, z: number, scale: number, big: boolean, seed: number): void {
    const rng = new Rng(seed);
    const n = Math.round(BURST_BASE * scale * (big ? BIG_BONUS : 1));
    for (let k = 0; k < n; k++) {
      const yaw = rng.range(0, 6.283);
      const lift = rng.range(0.9, 1.5);
      const out = rng.range(0.4, big ? 3.0 : 2.4);
      const speed = rng.range(2.6, big ? 5.6 : 4.6);
      scratchP.set(x + rng.range(-0.1, 0.1), BURST_HEIGHT, z + rng.range(-0.1, 0.1));
      this.emit(
        rng,
        scratchP,
        Math.cos(yaw) * out,
        speed * (lift / 1.5) + 1.2,
        Math.sin(yaw) * out,
        rng.range(MIN_LIFE, MAX_LIFE),
        rng.range(0.8, 1.35),
      );
    }
  }

  sparks(x: number, z: number, seed: number): void {
    const rng = new Rng(seed);
    for (let k = 0; k < 16; k++) {
      const yaw = rng.range(0, 6.283);
      const out = rng.range(0.4, 1.3);
      scratchP.set(x, 1.5, z);
      this.emit(rng, scratchP, Math.cos(yaw) * out, rng.range(0.4, 1.8), Math.sin(yaw) * out, rng.range(0.5, 0.9), 0.8);
    }
  }

  shower(rect: TileRect, scale: number, seed: number): void {
    if (this.emitters.length >= MAX_EMITTERS) this.emitters.shift();
    this.emitters.push({
      rect: { x: rect.x * TILE_M, z: rect.y * TILE_M, w: rect.w * TILE_M, d: rect.h * TILE_M },
      left: SHOWER_SECONDS,
      carry: 0,
      scale,
      rng: new Rng(seed),
    });
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);
    for (const e of this.emitters) this.run(e, step);
    this.emitters = this.emitters.filter((e) => e.left > 0);
    if (this.alive === 0) {
      this.mesh.count = 0;
      return;
    }
    const drag = Math.exp(-DRAG * step);
    let n = 0;
    for (let i = 0; i < CAPACITY; i++) {
      const life = this.life[i] as number;
      if (life <= 0) continue;
      const left = life - step;
      if (left <= 0) {
        this.life[i] = 0;
        this.alive--;
        continue;
      }
      this.life[i] = left;
      this.integrate(i, step, drag, left);
      this.write(n++, i, left);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private integrate(i: number, step: number, drag: number, left: number): void {
    const flutter = Math.sin((this.maxLife[i] as number) * 3 - left * 7 + (this.phase[i] as number)) * 0.9;
    const k = i * 3;
    this.vel[k] = (this.vel[k] as number) * drag + flutter * step;
    this.vel[k + 1] = (this.vel[k + 1] as number) * drag - GRAVITY * step * (1 - drag * 0.35);
    this.vel[k + 2] = (this.vel[k + 2] as number) * drag - flutter * 0.6 * step;
    this.pos[k] = (this.pos[k] as number) + (this.vel[k] as number) * step;
    this.pos[k + 1] = (this.pos[k + 1] as number) + (this.vel[k + 1] as number) * step;
    this.pos[k + 2] = (this.pos[k + 2] as number) + (this.vel[k + 2] as number) * step;
    for (let a = 0; a < 3; a++) this.rot[k + a] = (this.rot[k + a] as number) + (this.spin[k + a] as number) * step;
    if ((this.pos[k + 1] as number) < 0.02) {
      this.pos[k + 1] = 0.02;
      this.vel[k] = 0;
      this.vel[k + 1] = 0;
      this.vel[k + 2] = 0;
      for (let a = 0; a < 3; a++) this.spin[k + a] = 0;
      this.life[i] = Math.min(this.life[i] as number, 0.9);
    }
  }

  private write(slot: number, i: number, left: number): void {
    const k = i * 3;
    scratchE.set(this.rot[k] as number, this.rot[k + 1] as number, this.rot[k + 2] as number);
    scratchQ.setFromEuler(scratchE);
    const shrink = left < SHRINK_SECONDS ? left / SHRINK_SECONDS : 1;
    const s = (this.scale[i] as number) * shrink;
    scratchP.set(this.pos[k] as number, this.pos[k + 1] as number, this.pos[k + 2] as number);
    scratchM.compose(scratchP, scratchQ, scratchS.set(s, s, s));
    this.mesh.setMatrixAt(slot, scratchM);
    this.mesh.setColorAt(slot, colors[this.tint[i] as number] as Color);
  }

  private run(e: Emitter, dt: number): void {
    e.left -= dt;
    e.carry += SHOWER_PER_SECOND * e.scale * dt;
    while (e.carry >= 1) {
      e.carry -= 1;
      scratchP.set(e.rect.x + e.rng.range(0, e.rect.w), SHOWER_HEIGHT, e.rect.z + e.rng.range(0, e.rect.d));
      this.emit(
        e.rng,
        scratchP,
        e.rng.range(-0.3, 0.3),
        e.rng.range(-0.6, -0.1),
        e.rng.range(-0.3, 0.3),
        e.rng.range(MIN_LIFE + 0.6, MAX_LIFE + 1),
        e.rng.range(0.8, 1.3),
      );
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.dispose();
  }
}
