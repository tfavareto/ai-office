// Café, bathrooms, lounge and terrace furniture.
import { TILE_M as T } from '../units';
import type { FurnCtx } from './furnitureContext';
import { placeModel } from './models';
import { TorusGeometry } from 'three';
import { boxGeometry, transform } from '../util/parts';

export function buildCounter(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.walnutDark, 0, 0, 0, w, 0.88, d * 0.8, 0, 1);
  c.boxOn(m.marbleWall, 0, 0.88, 0, w + 0.04, 0.04, d * 0.85, 0, 2);
  c.boxOn(m.brass, 0, 0.0, d * 0.4 + 0.005, w, 0.06, 0.01);
  for (let i = 0; i < Math.round(w / 0.75); i++) {
    const x = -w / 2 + 0.375 + i * 0.75;
    c.boxOn(m.brass, x, 0.6, d * 0.4 + 0.012, 0.25, 0.015, 0.015);
    c.boxOn(m.graphite, x - 0.375, 0.05, d * 0.4 + 0.004, 0.006, 0.78, 0.004);
  }
  c.boxOn(m.steel, -w / 2 + 6 * T, 0.88, 0, 0.5, 0.01, 0.4);
  c.cylinder(m.steel, -w / 2 + 6 * T, 0.89, 0.05, 0.02, 0.2);
}

export function buildCoffeeMachine(f: FurnCtx): void {
  const { c, m } = f;
  c.boxOn(m.graphite, 0, 0.92, 0, 0.5, 0.5, 0.4);
  c.boxOn(m.steel, 0, 1.38, 0, 0.5, 0.05, 0.42);
  c.boxOn(m.black, 0, 1.0, 0.205, 0.38, 0.24, 0.01);
  c.boxOn(m.led('#ffb347'), 0.12, 1.28, 0.205, 0.05, 0.02, 0.01);
  c.boxOn(m.steel, 0, 0.92, 0.12, 0.2, 0.02, 0.18);
  c.cylinder(m.ceramic, 0, 0.94, 0.14, 0.035, 0.07);
}

export function buildFridge(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.steel, 0, 0, 0, w * 0.8, 1.85, d * 0.85);
  c.boxOn(m.black, 0, 0, d * 0.43, 0.01, 1.85, 0.005);
  for (const s of [-1, 1]) c.boxOn(m.black, s * 0.07, 0.8, d * 0.435, 0.025, 0.5, 0.025);
  c.boxOn(m.led('#bfe9ff'), -w * 0.2, 1.5, d * 0.435, 0.12, 0.05, 0.006);
}

export function buildVending(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.graphite, 0, 0, 0, w * 0.75, 1.85, d * 0.85);
  c.boxOn(m.led('#e8f4ff'), -0.12, 0.5, d * 0.43, w * 0.75 * 0.6, 1.2, 0.01);
  const colors = ['#e0525a', '#e8b84a', '#4aa3e8', '#58c47a', '#c06ae0'];
  for (let r = 0; r < 5; r++)
    for (let k = 0; k < 4; k++)
      c.boxOn(m.solid(colors[(r + k) % 5], 0.6), -0.4 + k * 0.17, 0.58 + r * 0.2, d * 0.435, 0.12, 0.13, 0.015);
  c.boxOn(m.black, w * 0.28, 0.5, d * 0.434, 0.18, 0.5, 0.012);
  f.light(0, 1.0, d * 0.5, false);
}

export function buildHighTable(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.walnut, 0, 1.02, 0, w * 0.85, 0.04, d * 0.8, 0, 1);
  c.cylinder(m.graphite, 0, 0, 0, 0.03, 1.02, 12);
  c.cylinder(m.graphite, 0, 0, 0, 0.24, 0.025, 20);
}

export function buildStool(f: FurnCtx): void {
  const { c, m } = f;
  c.cylinder(m.leather('#2b2f37'), 0, 0.62, 0, 0.2, 0.06, 20);
  c.cylinder(m.steel, 0, 0.0, 0, 0.022, 0.62, 10);
  c.cylinder(m.steel, 0, 0.0, 0, 0.18, 0.02, 20);
  c.add(ringGeo, m.steel, transform(0, 0.28, 0));
}

const ringGeo = new TorusGeometry(0.15, 0.008, 6, 24).rotateX(Math.PI / 2);

export function buildRoundTable(f: FurnCtx): void {
  placeModel(f.c, f.models.roundTable, 0, 0, { width: f.w * 0.78, depth: f.d * 0.78, height: 0.74 });
  f.c.cylinder(f.m.ceramic, 0.2, 0.74, 0.1, 0.04, 0.09);
}

export function buildCafeChair(f: FurnCtx): void {
  const yaw = Math.PI; // the model's front looks to -z
  placeModel(f.c, f.models.diningChair, 0, 0, { scale: 1.0, yaw });
}

export function buildStall(f: FurnCtx): void {
  const { c, m, w, d } = f;
  const wall = m.whiteGloss;
  for (const s of [-1, 1]) c.boxOn(wall, s * (w / 2 - 0.02), 0.12, 0, 0.03, 1.85, d);
  c.boxOn(wall, 0, 0.12, -d / 2 + 0.02, w, 1.85, 0.03);
  c.boxOn(m.walnut, 0.1, 0.12, d / 2 - 0.02, w - 0.3, 1.85, 0.035);
  c.cylinder(m.ceramic, 0, 0.0, -d / 2 + 0.3, 0.19, 0.4, 20, 0.22);
  c.boxOn(m.ceramic, 0, 0.4, -d / 2 + 0.16, 0.34, 0.4, 0.16);
  c.boxOn(m.steel, 0.55, 0.9, d / 2 - 0.005, 0.03, 0.03, 0.03);
}

export function buildSink(f: FurnCtx): void {
  const { c, m } = f;
  c.boxOn(m.walnutDark, 0, 0, 0, 0.7, 0.8, 0.5);
  c.boxOn(m.marbleWall, 0, 0.8, 0, 0.72, 0.04, 0.54, 0, 2);
  c.boxOn(m.ceramic, 0, 0.84, 0.02, 0.4, 0.1, 0.34);
  c.cylinder(m.steel, 0, 0.84, -0.18, 0.015, 0.22);
  c.boxOn(m.steel, 0, 1.04, -0.12, 0.02, 0.02, 0.12);
}

export function buildPingPong(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.solid('#17527a', 0.5), 0, 0.72, 0, w * 0.74, 0.03, d * 0.72);
  c.boxOn(m.ceramic, 0, 0.752, 0, w * 0.74, 0.003, 0.02);
  c.boxOn(m.ceramic, 0, 0.752, 0, 0.02, 0.003, d * 0.72);
  c.boxOn(m.black, 0, 0.752, 0, 0.012, 0.15, d * 0.74);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) c.boxOn(m.graphite, sx * w * 0.3, 0, sz * d * 0.28, 0.06, 0.72, 0.06);
}

export function buildArcade(f: FurnCtx): void {
  const { c, m } = f;
  const v = f.item.variant;
  c.boxOn(m.solid(v ? '#8a2f5a' : '#2f4a8a', 0.5), 0, 0, 0, 0.62, 1.75, 0.55);
  c.boxOn(m.black, 0, 1.05, 0.28, 0.5, 0.4, 0.01);
  c.boxOn(m.led(v ? '#ff7ac8' : '#6ac8ff'), 0, 1.06, 0.286, 0.44, 0.34, 0.004);
  c.boxOn(m.black, 0, 0.82, 0.3, 0.52, 0.06, 0.2);
  c.cylinder(m.solid('#d33', 0.4), -0.1, 0.85, 0.32, 0.018, 0.1);
  c.boxOn(m.led(v ? '#ff7ac8' : '#6ac8ff'), 0, 1.58, 0.28, 0.5, 0.12, 0.01);
}

export function buildBeanbag(f: FurnCtx): void {
  const colors = ['#c9573d', '#3d7ec9'];
  f.c.sphere(f.m.fabric(colors[f.item.variant % 2]), 0, 0.28, 0, 0.36, 1.05, 0.8, 1.05);
}

export function buildBookshelf(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.walnutDark, 0, 0, -d * 0.4, w, 2.0, 0.04);
  for (const s of [-1, 0, 1]) c.boxOn(m.walnut, s * (w / 2 - 0.02), 0, 0, 0.04, 2.0, d * 0.9);
  const palette = ['#9b3b3b', '#2d4a7a', '#c9a456', '#3d6b4a', '#e8e2d4', '#5d3a6e'];
  for (let shelf = 0; shelf < 5; shelf++) {
    const y = 0.05 + shelf * 0.4;
    c.boxOn(m.walnut, 0, y, 0, w - 0.04, 0.03, d * 0.9);
    let x = -w / 2 + 0.08;
    let i = shelf * 3;
    while (x < w / 2 - 0.2) {
      const bw = 0.03 + ((i * 7) % 5) * 0.008;
      const bh = 0.22 + ((i * 11) % 4) * 0.035;
      c.boxOn(m.solid(palette[i % palette.length], 0.7), x + bw / 2, y + 0.03, 0, bw, bh, d * 0.55);
      x += bw + 0.004;
      i++;
      if (i % 9 === 0) x += 0.25;
    }
  }
  c.boxOn(m.walnut, 0, 2.0, 0, w, 0.04, d * 0.9);
}

export function buildDeckChair(f: FurnCtx): void {
  const { c, m } = f;
  c.boxOn(m.walnut, 0, 0.35, 0, 0.5, 0.04, 0.5);
  c.add(slab, m.walnut, transform(0, 0.62, -0.23, 0, -0.25));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.boxOn(m.graphite, sx * 0.23, 0, sz * 0.23, 0.03, 0.35, 0.03);
  c.boxOn(m.fabric('#e8e2d4'), 0, 0.39, 0, 0.46, 0.06, 0.46);
}

const slab = boxGeometry(0.5, 0.5, 0.04);

export function buildDeckTable(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.walnut, 0, 0.72, 0, w * 0.8, 0.04, d * 0.8);
  c.cylinder(m.graphite, 0, 0, 0, 0.04, 0.72, 10);
  c.cylinder(m.graphite, 0, 0, 0, 0.3, 0.03, 16);
  c.cylinder(m.fabric('#e8e2d4'), 0.3, 1.5, 0.2, 0.9, 0.02, 24);
  c.cylinder(m.steel, 0.3, 0.72, 0.2, 0.02, 0.8);
}

export function buildRailing(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.glass, 0, 0.1, 0, w, 0.9, d);
  c.boxOn(m.brass, 0, 1.0, 0, w, 0.04, d);
}
