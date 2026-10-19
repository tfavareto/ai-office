// Workstations, chairs, storage, decor and reception furniture.
import { DESK_H } from '../units';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { boxGeometry, PartCollector, transform } from '../util/parts';
import type { FurnCtx } from './furnitureContext';
import type { Materials } from './materials';
import { placeModel } from './models';

const boxOf = (x: number, y: number, z: number): BufferGeometry => boxGeometry(x, y, z);
const CHAIR_COLORS = ['#2b2f37', '#7d828b', '#8a5a3c'];

/** Swivel office chair in local space (front +z). */
export function officeChair(c: PartCollector, m: Materials, x: number, z: number, yaw: number, variant: number, scale = 1): void {
  const local = new PartCollector();
  const seatMat = variant === 2 ? m.leather(CHAIR_COLORS[2]) : m.fabric(CHAIR_COLORS[variant % 3], 0.9);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    local.add(boxOf(0.05, 0.025, 0.3), m.graphite, transform(Math.sin(a) * 0.15, 0.09, Math.cos(a) * 0.15, a));
    local.sphere(m.black, Math.sin(a) * 0.29, 0.035, Math.cos(a) * 0.29, 0.03);
  }
  local.cylinder(m.steel, 0, 0.1, 0, 0.025, 0.3);
  local.box(seatMat, 0, 0.45, 0, 0.5, 0.08, 0.5);
  local.box(m.graphite, 0, 0.405, 0, 0.3, 0.02, 0.3);
  local.add(boxOf(0.46, 0.5, 0.06), seatMat, transform(0, 0.76, -0.25, 0, -0.1));
  local.box(m.graphite, 0, 0.58, -0.22, 0.05, 0.16, 0.05);
  for (const s of [-1, 1]) {
    local.box(m.graphite, s * 0.27, 0.6, 0.02, 0.04, 0.03, 0.3);
    local.box(m.graphite, s * 0.27, 0.54, -0.1, 0.03, 0.12, 0.03);
  }
  c.addAll(local, transform(x, 0, z, yaw, 0, 0, scale, scale, scale));
}

export function buildDesk(f: FurnCtx): void {
  const { c, m, w, d } = f;
  const deskIndex = f.item.variant;
  c.boxOn(m.walnut, 0, DESK_H - 0.04, 0, w, 0.04, d, 0, 1);
  c.boxOn(m.brass, 0, DESK_H - 0.045, d / 2 - 0.005, w, 0.03, 0.01);
  for (const s of [-1, 1]) c.boxOn(m.graphite, s * (w / 2 - 0.05), 0, 0, 0.04, DESK_H - 0.04, d - 0.06);
  c.boxOn(m.graphite, 0, 0.3, -d / 2 + 0.05, w - 0.1, 0.4, 0.02);
  // four monitors on an arc
  const xs = [-1.12, -0.38, 0.38, 1.12];
  const yaws = [0.34, 0.1, -0.1, -0.34];
  xs.forEach((x, i) => {
    const z = -0.16 + Math.abs(x) * 0.07;
    const local = new PartCollector();
    local.boxOn(m.graphite, 0, 0.0, 0, 0.22, 0.012, 0.14);
    local.boxOn(m.graphite, 0, 0.0, -0.01, 0.04, 0.22, 0.03);
    local.box(m.black, 0, 0.3, 0.0, 0.58, 0.34, 0.025);
    c.addAll(local, transform(x, DESK_H, z, yaws[i]));
    f.screen(deskIndex, i, transform(x, DESK_H + 0.3, z, yaws[i]).multiply(transform(0, 0, 0.0135)), 0.55, 0.31);
  });
  // keyboard, mouse and desk accessories
  c.boxOn(m.black, 0, DESK_H, 0.18, 0.44, 0.015, 0.14);
  c.boxOn(m.black, 0.36, DESK_H, 0.2, 0.06, 0.02, 0.1);
  const v = deskIndex % 3;
  if (v === 0) c.cylinder(m.ceramic, -1.2, DESK_H, 0.18, 0.04, 0.09);
  if (v === 1) {
    c.boxOn(m.fabric('#2d4a7a'), -1.15, DESK_H, 0.2, 0.2, 0.025, 0.28);
    c.boxOn(m.ceramic, -1.15, DESK_H + 0.025, 0.2, 0.19, 0.004, 0.27);
  }
  if (v === 2) {
    c.cylinder(m.ceramic, 1.25, DESK_H, 0.18, 0.045, 0.08, 12, 0.055);
    for (const [dx, dy, r] of [[0, 0.12, 0.06], [-0.04, 0.09, 0.045], [0.045, 0.1, 0.05]] as const) c.sphere(m.solid('#3f7a4a', 0.8), 1.25 + dx, DESK_H + dy, 0.18, r);
  }
  if (deskIndex % 2 === 0) {
    c.boxOn(m.brass, 1.25, DESK_H, -0.02, 0.1, 0.012, 0.1);
    c.boxOn(m.brass, 1.25, DESK_H, -0.02, 0.014, 0.34, 0.014);
    c.boxOn(m.brass, 1.25, DESK_H + 0.34, 0.05, 0.1, 0.014, 0.16);
  }
}

export function buildChair(f: FurnCtx): void {
  officeChair(f.c, f.m, 0, 0, 0, f.item.variant);
}

export function buildShelf(f: FurnCtx): void {
  const { c, models, w, d } = f;
  if (f.item.variant === 1) {
    c.boxOn(f.m.walnutDark, 0, 0.08, 0, w, 0.8, d * 0.9, 0, 1);
    c.boxOn(f.m.slats, 0, 0.12, d * 0.45 + 0.004, w - 0.1, 0.72, 0.01, 0, 0.72);
    c.boxOn(f.m.brass, 0, 0.0, 0, w - 0.1, 0.08, d * 0.7);
    c.boxOn(f.m.walnut, 0, 0.88, 0, w + 0.04, 0.04, d * 0.95, 0, 1);
  } else {
    placeModel(c, models.shelves, 0, 0, { width: d * 0.9, depth: w, height: 1.9, yaw: Math.PI / 2 });
  }
}

export function buildCopier(f: FurnCtx): void {
  const { c, m } = f;
  c.boxOn(m.whiteGloss, 0, 0, 0, 0.6, 0.95, 0.55);
  c.boxOn(m.graphite, 0, 0.95, 0, 0.62, 0.05, 0.57);
  c.boxOn(m.black, 0, 0.82, 0.28, 0.24, 0.1, 0.01);
  c.boxOn(m.screenOff, 0.15, 0.88, 0.27, 0.16, 0.06, 0.012);
}

export function buildBin(f: FurnCtx): void {
  f.c.cylinder(f.m.graphite, 0, 0, 0, 0.17, 0.4, 16, 0.2);
  f.c.cylinder(f.m.steel, 0, 0.4, 0, 0.19, 0.02, 16);
}

export function buildLamp(f: FurnCtx): void {
  const { c, m } = f;
  c.cylinder(m.graphite, 0, 0, 0, 0.14, 0.03);
  c.cylinder(m.steel, 0, 0.03, 0, 0.015, 1.5);
  c.cylinder(m.led('#ffd9a0'), 0, 1.5, 0, 0.16, 0.26, 16, 0.12);
  c.cylinder(m.brass, 0, 1.5, 0, 0.165, 0.015, 16, 0.125);
  f.light(0, 1.45, 0, true);
}

const POT_COLORS = ['#e9e4da', '#2b2f37', '#b08a5a', '#8c8f94'];

export function buildPlant(f: FurnCtx, tall: boolean): void {
  const { c, m, models } = f;
  const v = f.item.variant;
  if (tall && f.area.kind !== 'project') {
    c.cylinder(m.solid(POT_COLORS[v % 4], 0.5), 0, 0, 0, 0.2, 0.42, 20, 0.24);
    placeModel(c, models.pachira, 0, 0, { scale: 0.95, y: 0.4, yaw: v * 1.7 });
    return;
  }
  const potH = tall ? 0.42 : 0.3;
  c.cylinder(m.solid(POT_COLORS[(v + 1) % 4], 0.5), 0, 0, 0, tall ? 0.2 : 0.17, potH, 16, tall ? 0.24 : 0.2);
  const model = v % 2 === 0 ? models.calathea : models.fern;
  placeModel(c, model, 0, 0, { scale: (v % 2 === 0 ? 1.2 : 0.75) * (tall ? 1.35 : 1), y: potH - 0.02, yaw: v });
}

export function buildRug(f: FurnCtx): void {
  const { c, m, w, d, area } = f;
  const t = area.theme;
  const pattern = (f.item.variant + t.pattern) % 4;
  const mat = m.rug(pattern, t.carpet, t.carpetAlt, t.accent);
  c.add(rugGeometry(w - 0.12, d - 0.12), mat, transform(0, 0.012, 0));
}

const rugGeos = new Map<string, BufferGeometry>();
function rugGeometry(w: number, d: number): BufferGeometry {
  const key = `${w.toFixed(2)}|${d.toFixed(2)}`;
  let g = rugGeos.get(key);
  if (!g) {
    g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute([-w / 2, 0, -d / 2, -w / 2, 0, d / 2, w / 2, 0, d / 2, w / 2, 0, -d / 2], 3));
    g.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    rugGeos.set(key, g);
  }
  return g;
}

export function buildBench(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.walnut, 0, 0.42, 0, w, 0.05, d * 0.7);
  for (const s of [-1, 1]) c.boxOn(m.steel, s * (w / 2 - 0.1), 0, 0, 0.04, 0.42, d * 0.6);
  c.boxOn(m.fabric('#46556e'), 0, 0.47, 0, w - 0.1, 0.04, d * 0.62);
}

export function buildCooler(f: FurnCtx): void {
  const { c, m } = f;
  c.boxOn(m.whiteGloss, 0, 0, 0, 0.36, 0.95, 0.36);
  c.cylinder(m.solid('#8fc9ea', 0.1), 0, 0.95, 0, 0.15, 0.4, 16);
  c.cylinder(m.steel, 0, 0.8, 0.17, 0.02, 0.04);
  c.boxOn(m.led('#6fd0ff'), 0, 0.88, 0.185, 0.14, 0.012, 0.01);
}

export function buildSideTable(f: FurnCtx): void {
  placeModel(f.c, f.models.sideTable, 0, 0, { scale: 1.0 });
}

export function buildReceptionDesk(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.marbleWall, 0, 0, d * 0.1, w, 1.05, d * 0.45, 0, 2);
  c.boxOn(m.walnutDark, 0, 1.05, d * 0.1, w + 0.02, 0.03, d * 0.45 + 0.02, 0, 1);
  c.boxOn(m.brass, 0, 1.05, d * 0.1 + d * 0.225 + 0.012, w + 0.02, 0.03, 0.012);
  c.boxOn(m.brass, 0, 0.0, d * 0.1 + d * 0.225 + 0.005, w, 0.05, 0.012);
  c.boxOn(m.walnut, 0, 0, -d * 0.18, w, 0.74, d * 0.4);
  c.boxOn(m.walnutDark, 0, 0.74, -d * 0.18, w, 0.04, d * 0.45, 0, 1);
  for (const x of [-1.3, 0, 1.3]) {
    c.boxOn(m.graphite, x, 0.78, -d * 0.18, 0.5, 0.01, 0.2);
    c.boxOn(m.graphite, x, 0.78, -d * 0.28, 0.05, 0.2, 0.03);
    c.boxOn(m.black, x, 0.99, -d * 0.28, 0.5, 0.3, 0.025);
    c.boxOn(m.led('#4fa3ff'), x, 1.0, -d * 0.268, 0.46, 0.26, 0.004);
  }
  for (const x of [-1.8, 0, 1.8]) {
    c.cylinder(m.led('#ffd9a0'), x, 2.0, 0.1, 0.13, 0.12, 16, 0.07);
    c.cylinder(m.steel, x, 2.12, 0.1, 0.004, 0.8);
    f.light(x, 1.95, 0.1, true);
  }
}

export function buildSofa(f: FurnCtx): void {
  const { c, m, w, d } = f;
  const v = f.item.variant;
  if (v >= 2) {
    placeModel(c, f.models.sofa, 0, 0, { width: w, depth: d * 1.1, height: 0.95 });
    return;
  }
  const mat = m.fabric(v === 0 ? '#d9cdb9' : '#7e8a91', 0.95);
  c.boxOn(mat, 0, 0.16, 0, w, 0.26, d, 0, 1);
  c.boxOn(mat, 0, 0.42, -d * 0.4, w, 0.4, d * 0.2);
  for (const s of [-1, 1]) c.boxOn(mat, s * (w / 2 - 0.1), 0.42, 0, 0.2, 0.28, d);
  c.boxOn(m.walnutDark, 0, 0.0, 0, w - 0.1, 0.16, d - 0.1);
  const seats = Math.max(2, Math.round(w / 0.75));
  for (let i = 0; i < seats; i++) c.boxOn(mat, -w / 2 + 0.3 + ((w - 0.6) * (i + 0.5)) / seats, 0.42, 0.04, (w - 0.6) / seats - 0.02, 0.12, d * 0.62);
}

export function buildCoffeeTable(f: FurnCtx): void {
  placeModel(f.c, f.models.coffeeTable, 0, 0, { width: f.d * 0.8, depth: f.w * 0.9, height: 0.4, yaw: Math.PI / 2 });
}

export function buildArmchair(f: FurnCtx): void {
  placeModel(f.c, f.models.loungeChair, 0, 0, { scale: 0.85, yaw: Math.PI });
}

export function buildMeetingTable(f: FurnCtx): void {
  const { c, m, w, d } = f;
  c.boxOn(m.walnut, 0, 0.7, 0, w, 0.05, d * 0.92, 0, 1);
  c.boxOn(m.brass, 0, 0.745, 0, w - 0.3, 0.008, 0.02);
  c.boxOn(m.graphite, 0, 0.66, 0, w - 0.4, 0.04, d * 0.8);
  for (const s of [-1, 1]) {
    c.boxOn(m.graphite, s * (w / 2 - 0.9), 0, 0, 0.1, 0.66, d * 0.5);
    c.boxOn(m.graphite, s * (w / 2 - 0.9), 0, 0, 0.5, 0.04, d * 0.6);
  }
  for (const x of [-1.6, 0, 1.6]) {
    c.boxOn(m.black, x, 0.75, 0, 0.18, 0.012, 0.14);
    c.boxOn(m.steel, x, 0.75, 0, 0.04, 0.006, 0.04);
  }
  c.boxOn(m.ceramic, -0.5, 0.75, 0.25, 0.05, 0.08, 0.05);
  c.boxOn(m.fabric('#2d4a7a'), 1.0, 0.75, -0.2, 0.2, 0.02, 0.28);
  for (const x of [-1.8, 0, 1.8]) {
    c.boxOn(m.led('#ffe2b3'), x, 2.1, 0, 0.9, 0.05, 0.1);
    c.boxOn(m.graphite, x, 2.15, 0, 0.92, 0.03, 0.12);
    c.boxOn(m.steel, x - 0.4, 2.2, 0, 0.006, 0.7, 0.006);
    c.boxOn(m.steel, x + 0.4, 2.2, 0, 0.006, 0.7, 0.006);
    f.light(x, 2.05, 0, true);
  }
}

export function buildMeetChair(f: FurnCtx): void {
  officeChair(f.c, f.m, 0, 0, 0, (f.item.variant + 1) % 3);
}
