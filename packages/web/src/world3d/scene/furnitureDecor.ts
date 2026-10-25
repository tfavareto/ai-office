// 3D builders of the unlockable decoration that stands on the floor: the aquarium, the trophy cabinet with its cups, the
// extra arcade machines and the poles and garland of the corridor. The plaque, the framed art and the neon sign are
// pictures on a wall or on the desk and live in decorScreens.ts.
import { DoubleSide, Matrix4, MeshStandardMaterial } from 'three';
import type { CupTier } from '../../world/evolution';
import { boxGeometry, transform } from '../util/parts';
import type { FurnCtx } from './furnitureContext';
import type { Materials } from './materials';

const CUP_METAL: Record<CupTier, string> = { bronze: '#b9773e', silver: '#c9d2dc', gold: '#f2c94c' };
const BULBS = ['#ffd98a', '#ff9d7a', '#8fe3ea', '#ffe9b0', '#c6a8ff'] as const;
const GOLD = '#e0b32e';
/** Distance between two bulbs of the garland (m). */
const BULB_STEP = 0.34;

let water: MeshStandardMaterial | null = null;

/** The water of the aquarium: tinted and see-through, shared by every tank. */
export function waterMaterial(): MeshStandardMaterial {
  water ??= new MeshStandardMaterial({
    color: '#2a9bbd',
    emissive: '#0e5f7d',
    emissiveIntensity: 0.5,
    roughness: 0.2,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: DoubleSide,
  });
  return water;
}

function trim(f: FurnCtx): string {
  return f.evolution.decor.has('goldFinish') ? GOLD : '';
}

function metal(m: Materials, f: FurnCtx): ReturnType<Materials['solid']> {
  const gold = trim(f);
  return gold === '' ? m.brass : m.solid(gold, 0.25, 1);
}

/** Inside size of the aquarium's water (m), used by the fish. */
export const TANK = { w: 1.3, h: 0.5, d: 0.5, y: 0.7 } as const;

export function buildAquarium(f: FurnCtx): void {
  const { c, m, w } = f;
  const wood = m.walnut;
  // stand: a walnut cabinet with two doors
  c.boxOn(wood, 0, 0, 0, w - 0.1, 0.66, 0.6);
  c.boxOn(m.walnutDark, 0, 0.66, 0, w - 0.06, 0.04, 0.64);
  for (const side of [-1, 1]) c.boxOn(m.walnutDark, side * (w / 4 - 0.02), 0.08, 0.305, w / 2 - 0.16, 0.5, 0.01);
  for (const x of [-0.08, 0.08]) c.boxOn(m.brass, x, 0.3, 0.315, 0.012, 0.1, 0.012);
  // tank
  const top = TANK.y;
  c.boxOn(m.black, 0, top, 0, TANK.w + 0.06, 0.03, TANK.d + 0.06);
  c.boxOn(m.glass, 0, top + 0.03, 0, TANK.w + 0.04, TANK.h, TANK.d + 0.04);
  c.boxOn(waterMaterial(), 0, top + 0.05, 0, TANK.w, TANK.h - 0.07, TANK.d);
  c.boxOn(m.solid('#d9c58f', 0.9), 0, top + 0.03, 0, TANK.w, 0.07, TANK.d);
  // an open frame on top (a lid would hide the fish from the camera) with the light bar at the back
  const roof = top + TANK.h + 0.03;
  for (const z of [-1, 1]) c.boxOn(m.graphite, 0, roof, z * (TANK.d / 2 + 0.015), TANK.w + 0.06, 0.04, 0.03);
  for (const x of [-1, 1]) c.boxOn(m.graphite, x * (TANK.w / 2 + 0.015), roof, 0, 0.03, 0.04, TANK.d);
  c.boxOn(m.graphite, 0, roof, -TANK.d / 2 + 0.07, TANK.w, 0.05, 0.1);
  c.boxOn(m.led('#f4f8ff'), 0, roof - 0.012, -TANK.d / 2 + 0.07, TANK.w - 0.1, 0.012, 0.05);
  // plants, a rock and a little castle
  const green = m.solid('#3b7a46', 0.8);
  const light = m.solid('#74b872', 0.8);
  for (const [x, z, h] of [
    [-0.5, -0.12, 0.26],
    [-0.42, -0.05, 0.18],
    [0.46, -0.1, 0.3],
    [0.38, 0.02, 0.2],
    [0.1, -0.16, 0.14],
  ] as const) {
    c.boxOn(green, x, top + 0.1, z, 0.025, h, 0.025);
    c.boxOn(light, x + 0.025, top + 0.1, z, 0.02, h * 0.7, 0.02);
  }
  c.sphere(m.solid('#7a7f87', 0.9), 0.05, top + 0.13, 0.04, 0.09, 1.2, 0.7, 0.9);
  c.boxOn(m.solid('#b9a98a', 0.8), -0.18, top + 0.1, 0.08, 0.1, 0.1, 0.08);
  c.boxOn(m.solid('#9c8d70', 0.8), -0.18, top + 0.2, 0.08, 0.12, 0.025, 0.1);
}

function cup(f: FurnCtx, x: number, y: number, z: number, tier: CupTier): void {
  const { c, m } = f;
  const mat = m.solid(CUP_METAL[tier], 0.22, 1);
  c.cylinder(mat, x, y, z, 0.038, 0.014, 14);
  c.cylinder(mat, x, y + 0.014, z, 0.008, 0.045, 8);
  c.cylinder(mat, x, y + 0.059, z, 0.018, 0.07, 14, 0.04);
  for (const s of [-1, 1]) c.boxOn(mat, x + s * 0.045, y + 0.09, z, 0.012, 0.03, 0.01);
}

export function buildTrophyCabinet(f: FurnCtx): void {
  const { c, m, w } = f;
  const depth = 0.5;
  const height = 1.75;
  const frame = m.walnutDark;
  const trimMat = metal(m, f);
  c.boxOn(frame, 0, 0, 0, w - 0.06, 0.12, depth);
  c.boxOn(m.walnut, 0, 0.12, -depth / 2 + 0.02, w - 0.06, height - 0.12, 0.04);
  for (const side of [-1, 1]) c.boxOn(frame, side * (w / 2 - 0.05), 0.12, 0, 0.05, height - 0.12, depth);
  c.boxOn(frame, 0, height, 0, w - 0.04, 0.05, depth + 0.04);
  c.boxOn(trimMat, 0, height + 0.05, 0.02, w - 0.04, 0.025, depth + 0.02);
  const shelves = [0.55, 1.1];
  for (const y of shelves) c.boxOn(m.glass, 0, y, 0, w - 0.14, 0.02, depth - 0.06);
  c.boxOn(m.led('#ffe6a8'), 0, height - 0.02, -0.05, w - 0.2, 0.012, 0.06);
  c.boxOn(m.glass, 0, 0.14, depth / 2 - 0.01, w - 0.13, height - 0.2, 0.012);
  c.boxOn(trimMat, 0, 0.14, depth / 2, 0.015, height - 0.2, 0.02);
  const perShelf = 4;
  const gap = (w - 0.3) / perShelf;
  f.evolution.cups.forEach((tier, index) => {
    const y = index < perShelf ? 1.12 : 0.57;
    const slot = index % perShelf;
    cup(f, -w / 2 + 0.15 + gap * (slot + 0.5), y, 0, tier);
  });
  // a little plaque under the glass
  c.boxOn(trimMat, 0, 0.2, depth / 2 + 0.005, 0.3, 0.07, 0.01);
}

export function buildDecorArcade(f: FurnCtx): void {
  const { c, m } = f;
  const violet = f.item.variant % 2 === 1;
  const neon = violet ? '#8f6bff' : '#ffb02e';
  c.boxOn(m.solid(violet ? '#2a2250' : '#4a3216', 0.5), 0, 0, 0, 0.62, 1.75, 0.55);
  c.boxOn(m.black, 0, 1.05, 0.28, 0.5, 0.4, 0.01);
  c.boxOn(m.led(neon), 0, 1.06, 0.286, 0.44, 0.34, 0.004);
  c.boxOn(m.black, 0, 0.82, 0.3, 0.52, 0.06, 0.2);
  c.cylinder(m.solid('#3ecf8e', 0.4), -0.1, 0.85, 0.32, 0.018, 0.1);
  c.cylinder(m.solid('#ff6a5a', 0.4), 0.1, 0.85, 0.32, 0.018, 0.1);
  c.boxOn(m.led(neon), 0, 1.58, 0.28, 0.5, 0.12, 0.01);
}

const wires = new Map<string, ReturnType<typeof boxGeometry>>();

function wireGeometry(length: number): ReturnType<typeof boxGeometry> {
  const key = length.toFixed(3);
  let geometry = wires.get(key);
  if (geometry === undefined) {
    geometry = boxGeometry(length, 0.01, 0.01);
    wires.set(key, geometry);
  }
  return geometry;
}

function wireMatrix(x: number, y: number, z: number, roll: number): Matrix4 {
  return transform(x, y, z, 0, 0, roll);
}

/** One segment of the corridor garland: poles at both ends and a swag of coloured bulbs between them. */
export function buildLights(f: FurnCtx): void {
  const { c, m, w, d } = f;
  const z = -d / 2 + 0.14;
  const topY = 2.45;
  const sag = 0.2;
  const pole = m.graphite;
  const x0 = -w / 2;
  for (const x of [x0, x0 + w]) {
    c.cylinder(pole, x, 0, z, 0.022, topY + 0.05, 10);
    c.cylinder(m.black, x, 0, z, 0.06, 0.03, 12);
  }
  const wire = m.black;
  const steps = Math.max(6, Math.round(w / 0.1));
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const y = (t: number): number => topY - sag * (1 - (2 * t - 1) ** 2);
    const x = (t: number): number => x0 + w * t;
    const dx = x(t1) - x(t0);
    const dy = y(t1) - y(t0);
    const len = Math.hypot(dx, dy);
    c.add(wireGeometry(len), wire, wireMatrix((x(t0) + x(t1)) / 2, (y(t0) + y(t1)) / 2, z, Math.atan2(dy, dx)));
  }
  const bulbs = Math.max(1, Math.floor(w / BULB_STEP));
  for (let i = 0; i < bulbs; i++) {
    const t = (i + 0.5) / bulbs;
    const y = topY - sag * (1 - (2 * t - 1) ** 2) - 0.07;
    const color = BULBS[(i + f.item.variant) % BULBS.length];
    c.sphere(m.led(color), x0 + w * t, y, z, 0.035, 1, 1.25, 1);
  }
}
