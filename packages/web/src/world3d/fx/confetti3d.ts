// Confetti for the 3D world, same party as 2D (`sim/confettiPlan.ts`): two cannons at the person's sides, a short
// fountain, tumbling pieces, twirling streamers and twinkling stars, plus a flash ring on the floor. Three instanced
// meshes (pieces, streamers, stars) with CPU physics in fixed pools; unlit and not tone-mapped so it stays bright at night.
import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { Rng } from '../../layout/rng';
import type { SimEffect, TileRect } from '../../sim/effects';
import { planBurst, showerPiece, type ConfettiSpec, type PieceKind } from '../../sim/confettiPlan';
import { CONFETTI_COLORS } from '../../world2d/fx/confetti';
import { TILE_M } from '../units';

const GRAVITY = 5.2;
const DRAG = 1.5;
const SHRINK_SECONDS = 0.45;
const CANNON_SPEED = 4.6;
const FOUNTAIN_SPEED = 5.4;
const CANNON_OFFSET = 0.3;
const CANNON_HEIGHT = 1.05;
const FOUNTAIN_HEIGHT = 1.3;
const SHOWER_SECONDS = 2.8;
const SHOWER_PER_SECOND = 170;
const SHOWER_HEIGHT = 3.3;
const MAX_EMITTERS = 4;
const RING_SECONDS = 0.5;
const MAX_RINGS = 4;

const colors = CONFETTI_COLORS.map((c) => new Color(c));
const scratchM = new Matrix4();
const scratchQ = new Quaternion();
const scratchE = new Euler();
const scratchP = new Vector3();
const scratchS = new Vector3();

interface Emitter {
  rect: { x: number; z: number; w: number; d: number };
  left: number;
  carry: number;
  scale: number;
  rng: Rng;
}

interface Launch {
  at: number;
  spec: ConfettiSpec;
  x: number;
  z: number;
  rng: Rng;
}

interface Ring {
  mesh: Mesh;
  age: number;
}

/** One instanced mesh with its own particle pool. */
class Layer {
  readonly mesh: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly tint: Uint8Array;
  private readonly phase: Float32Array;
  private readonly scale: Float32Array;
  private cursor = 0;
  alive = 0;

  constructor(
    geometry: BufferGeometry,
    private readonly capacity: number,
    private readonly ribbon: boolean,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.tint = new Uint8Array(capacity);
    this.phase = new Float32Array(capacity);
    this.scale = new Float32Array(capacity);
    const material = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 10;
    this.mesh.setColorAt(0, colors[0] as Color);
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
    this.mesh.count = 0;
  }

  private take(): number {
    for (let n = 0; n < this.capacity; n++) {
      const i = (this.cursor + n) % this.capacity;
      if ((this.life[i] as number) <= 0) {
        this.cursor = (i + 1) % this.capacity;
        this.alive++;
        return i;
      }
    }
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    return i;
  }

  emit(rng: Rng, p: Vector3, vx: number, vy: number, vz: number, life: number, color: number, size: number): void {
    const i = this.take();
    const k = i * 3;
    this.pos[k] = p.x;
    this.pos[k + 1] = p.y;
    this.pos[k + 2] = p.z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    for (let a = 0; a < 3; a++) {
      this.rot[k + a] = rng.range(0, 6.28);
      this.spin[k + a] = rng.range(-10, 10);
    }
    this.life[i] = life;
    this.maxLife[i] = life;
    this.tint[i] = color;
    this.phase[i] = rng.range(0, 6.28);
    this.scale[i] = size;
  }

  update(step: number): void {
    if (this.alive === 0) {
      this.mesh.count = 0;
      return;
    }
    const drag = Math.exp(-DRAG * step);
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
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
    const flutter =
      Math.sin((this.maxLife[i] as number) * 3 - left * 7 + (this.phase[i] as number)) * (this.ribbon ? 1.6 : 0.9);
    const gravity = GRAVITY * (this.ribbon ? 0.5 : 1);
    const k = i * 3;
    this.vel[k] = (this.vel[k] as number) * drag + flutter * step;
    this.vel[k + 1] = (this.vel[k + 1] as number) * drag - gravity * step * (1 - drag * 0.35);
    this.vel[k + 2] = (this.vel[k + 2] as number) * drag - flutter * 0.6 * step;
    for (let a = 0; a < 3; a++) {
      this.pos[k + a] = (this.pos[k + a] as number) + (this.vel[k + a] as number) * step;
      this.rot[k + a] = (this.rot[k + a] as number) + (this.spin[k + a] as number) * step;
    }
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

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.dispose();
  }
}

export class Confetti3D {
  readonly group = new Group();
  private readonly pieces: Layer;
  private readonly ribbons: Layer;
  private readonly stars: Layer;
  private readonly rings: Ring[] = [];
  private readonly ringGeometry = new RingGeometry(0.4, 0.5, 40).rotateX(-Math.PI / 2);
  private emitters: Emitter[] = [];
  private launches: Launch[] = [];
  private clock = 0;

  constructor() {
    this.pieces = new Layer(new PlaneGeometry(0.12, 0.07), 1700, false);
    this.ribbons = new Layer(new PlaneGeometry(0.035, 0.34), 500, true);
    this.stars = new Layer(new PlaneGeometry(0.13, 0.13).rotateZ(Math.PI / 4), 260, false);
    this.group.add(this.pieces.mesh, this.ribbons.mesh, this.stars.mesh);
  }

  get count(): number {
    return this.pieces.alive + this.ribbons.alive + this.stars.alive;
  }

  get busy(): boolean {
    return this.count > 0 || this.emitters.length > 0 || this.launches.length > 0 || this.rings.length > 0;
  }

  clear(): void {
    for (const layer of [this.pieces, this.ribbons, this.stars]) layer.clear();
    this.emitters = [];
    this.launches = [];
    for (const r of this.rings) r.mesh.removeFromParent();
    this.rings.length = 0;
  }

  apply(effect: SimEffect): void {
    if (effect.type === 'burst')
      this.burst(effect.x * TILE_M, effect.y * TILE_M, effect.scale, effect.big, effect.seed);
    else if (effect.type === 'shower') this.shower(effect.rect, effect.scale, effect.seed);
    else if (effect.type === 'spark') this.sparks(effect.x * TILE_M, effect.y * TILE_M, effect.seed);
  }

  private layerOf(kind: PieceKind): Layer {
    return kind === 'ribbon' ? this.ribbons : kind === 'star' ? this.stars : this.pieces;
  }

  private launch(l: Launch): void {
    const { spec, rng } = l;
    const cannon = spec.origin !== 'fountain';
    const side = spec.origin === 'left' ? -1 : spec.origin === 'right' ? 1 : 0;
    const speed = (cannon ? CANNON_SPEED : FOUNTAIN_SPEED) * spec.speed;
    scratchP.set(
      l.x + side * CANNON_OFFSET + rng.range(-0.04, 0.04),
      cannon ? CANNON_HEIGHT : FOUNTAIN_HEIGHT,
      l.z + rng.range(-0.04, 0.04),
    );
    const size = spec.kind === 'star' ? 1.3 : 0.75 + spec.size * 0.3;
    this.layerOf(spec.kind).emit(
      rng,
      scratchP,
      Math.cos(spec.angle) * speed,
      Math.sin(spec.angle) * speed,
      spec.depth * speed * 0.35,
      spec.life,
      spec.color,
      size,
    );
  }

  /** Two cannons and a fountain around a person standing at (x, z) metres, with a flash ring on the floor. */
  burst(x: number, z: number, scale: number, big: boolean, seed: number): void {
    const rng = new Rng(seed ^ 0x51ed);
    for (const spec of planBurst(scale, big, seed)) {
      const l: Launch = { at: this.clock + spec.delay, spec, x, z, rng };
      if (spec.delay <= 0.001) this.launch(l);
      else this.launches.push(l);
    }
    this.flash(x, z);
  }

  private flash(x: number, z: number): void {
    if (this.rings.length >= MAX_RINGS) {
      const old = this.rings.shift();
      old?.mesh.removeFromParent();
    }
    const material = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(this.ringGeometry, material);
    mesh.position.set(x, 0.04, z);
    mesh.renderOrder = 9;
    this.group.add(mesh);
    this.rings.push({ mesh, age: 0 });
  }

  sparks(x: number, z: number, seed: number): void {
    const rng = new Rng(seed);
    for (let k = 0; k < 16; k++) {
      const yaw = rng.range(0, 6.283);
      const out = rng.range(0.4, 1.3);
      scratchP.set(x, 1.5, z);
      this.stars.emit(
        rng,
        scratchP,
        Math.cos(yaw) * out,
        rng.range(0.4, 1.8),
        Math.sin(yaw) * out,
        rng.range(0.5, 0.9),
        k % 2 === 0 ? 7 : 1,
        0.8,
      );
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
    this.clock += step;
    for (const e of this.emitters) this.run(e, step);
    this.emitters = this.emitters.filter((e) => e.left > 0);
    this.runLaunches();
    this.updateRings(step);
    for (const layer of [this.pieces, this.ribbons, this.stars]) layer.update(step);
  }

  private runLaunches(): void {
    if (this.launches.length === 0) return;
    const waiting: Launch[] = [];
    for (const l of this.launches) {
      if (l.at <= this.clock) this.launch(l);
      else waiting.push(l);
    }
    this.launches = waiting;
  }

  private updateRings(step: number): void {
    for (const r of this.rings) {
      r.age += step;
      const t = Math.min(1, r.age / RING_SECONDS);
      const material = r.mesh.material as MeshBasicMaterial;
      material.opacity = (1 - t) * 0.95;
      material.color.set(t < 0.35 ? '#ffffff' : '#ffe27a');
      r.mesh.scale.setScalar(0.4 + t * 2.4);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i] as Ring;
      if (r.age < RING_SECONDS) continue;
      (r.mesh.material as MeshBasicMaterial).dispose();
      r.mesh.removeFromParent();
      this.rings.splice(i, 1);
    }
  }

  private run(e: Emitter, dt: number): void {
    e.left -= dt;
    e.carry += SHOWER_PER_SECOND * e.scale * dt;
    while (e.carry >= 1) {
      e.carry -= 1;
      const piece = showerPiece(e.rng);
      scratchP.set(e.rect.x + e.rng.range(0, e.rect.w), SHOWER_HEIGHT, e.rect.z + e.rng.range(0, e.rect.d));
      const size = piece.kind === 'star' ? 1.3 : 0.75 + piece.size * 0.3;
      this.layerOf(piece.kind).emit(
        e.rng,
        scratchP,
        e.rng.range(-0.3, 0.3),
        e.rng.range(-0.6, -0.1),
        e.rng.range(-0.3, 0.3),
        piece.life,
        piece.color,
        size,
      );
    }
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
    for (const layer of [this.pieces, this.ribbons, this.stars]) layer.dispose();
    this.ringGeometry.dispose();
  }
}
