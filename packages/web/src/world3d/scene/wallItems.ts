// Wall-mounted items: signs, boards and TVs (canvas screens), clocks, posters, mirrors and the elevator cabs.
import { Mesh, PlaneGeometry, type Group } from 'three';
import { WALL_ROWS } from '../../layout/constants';
import type { AreaLayout, WallItem } from '../../layout/types';
import { TILE_M as T } from '../units';
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three';
import { boxGeometry, transform, type PartCollector } from '../util/parts';
import type { Materials } from './materials';
import { type WorldText, worldText } from '../../i18n/world/translate';
import { CanvasScreen, DecorAtlas, type DecorPainter, paintMenu, paintPoster, paintSign } from './screens';

export interface ElevatorRig {
  left: Mesh;
  right: Mesh;
  /** Distance each leaf slides when fully open. */
  travel: number;
  index: number;
  leftX: number;
  rightX: number;
}

export interface WallScreens {
  board?: CanvasScreen;
  meetingTv?: CanvasScreen;
  /** The whiteboard: the live task board. */
  whiteboard?: CanvasScreen;
  loungeTv?: CanvasScreen;
  elevators: ElevatorRig[];
  /** All screens created for this area (disposed with it). */
  all: CanvasScreen[];
  /** Static decor (signs, posters, menu) shares this atlas; null until an item needs it. */
  decor: DecorAtlas | null;
}

function quadGeometry(w: number, h: number, uv: [number, number, number, number]): BufferGeometry {
  const [u0, vt0, u1, vt1] = uv;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0], 3));
  g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new Float32BufferAttribute([u0, 1 - vt1, u1, 1 - vt1, u1, 1 - vt0, u0, 1 - vt0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A static decor image as a merged quad (no extra draw call). */
function decorQuad(
  c: PartCollector, out: WallScreens, x: number, y: number, z: number, w: number, h: number,
  painter: DecorPainter, text: WorldText, localized = false,
): void {
  out.decor ??= new DecorAtlas(text);
  const slot = out.decor.add(w, h, painter, localized);
  c.add(quadGeometry(w, h, slot.uv), out.decor.material, transform(x, y, z));
}

const planeCache = new Map<string, PlaneGeometry>();
function plane(w: number, h: number): PlaneGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}`;
  let g = planeCache.get(key);
  if (!g) {
    g = new PlaneGeometry(w, h);
    planeCache.set(key, g);
  }
  return g;
}

function addScreen(dynamic: Group, screen: CanvasScreen, x: number, y: number, z: number, w: number, h: number): void {
  const mesh = new Mesh(plane(w, h), screen.material);
  mesh.position.set(x, y, z);
  dynamic.add(mesh);
}

/** Framed screen: static frame parts + a dynamic canvas plane. */
function framedScreen(c: PartCollector, m: Materials, dynamic: Group, screen: CanvasScreen, x: number, y: number, z: number, w: number, h: number): void {
  c.box(m.black, x, y, z + 0.02, w + 0.06, h + 0.06, 0.04);
  addScreen(dynamic, screen, x, y, z + 0.045, w, h);
}

function elevatorCab(c: PartCollector, m: Materials, dynamic: Group, a: number, b: number, zFace: number, index: number, rigs: ElevatorRig[]): void {
  const w = b - a;
  const mid = (a + b) / 2;
  const depth = 1.05;
  const zBack = zFace - depth;
  c.boxOn(m.plasterWarm, mid, 0.0, zBack, w + 0.2, 2.4, 0.06);
  for (const s of [-1, 1]) c.boxOn(m.plasterWarm, mid + s * (w / 2 + 0.07), 0, zFace - depth / 2, 0.06, 2.4, depth);
  c.boxOn(m.floor('stone'), mid, 0.002, zFace - depth / 2, w, 0.004, depth);
  c.boxOn(m.led('#fff1d6'), mid, 2.38, zFace - depth / 2, w - 0.2, 0.03, depth - 0.2);
  c.boxOn(m.plasterWarm, mid, 2.4, zFace - depth / 2, w + 0.2, 0.05, depth + 0.06);
  c.boxOn(m.steel, mid, 0, zBack + 0.04, w - 0.1, 2.2, 0.02);
  c.boxOn(m.steel, a, 0, zFace, 0.06, 2.45, 0.14);
  c.boxOn(m.steel, b, 0, zFace, 0.06, 2.45, 0.14);
  c.boxOn(m.steel, mid, 2.45, zFace, w + 0.06, 0.08, 0.14);
  c.boxOn(m.led('#ffb347'), mid, 2.62, zFace + 0.03, 0.18, 0.06, 0.02);
  c.boxOn(m.graphite, b + 0.18, 1.0, zFace + 0.02, 0.1, 0.2, 0.03);
  c.boxOn(m.led('#6fd0ff'), b + 0.18, 1.08, zFace + 0.04, 0.03, 0.03, 0.01);
  const leafW = w / 2 - 0.03;
  const make = (side: -1 | 1): Mesh => {
    const mesh = new Mesh(boxGeometry(leafW, 2.2, 0.04), m.steel);
    mesh.position.set(mid + side * (leafW / 2 + 0.01), 1.1, zFace - 0.05);
    mesh.castShadow = true;
    dynamic.add(mesh);
    return mesh;
  };
  const left = make(-1);
  const right = make(1);
  rigs.push({ left, right, travel: leafW - 0.03, index, leftX: left.position.x, rightX: right.position.x });
}

const clockFace = new CylinderGeometry(0.21, 0.21, 0.012, 28).rotateX(Math.PI / 2);
const clockRim = new CylinderGeometry(0.23, 0.23, 0.03, 28).rotateX(Math.PI / 2);

function clock(c: PartCollector, m: Materials, x: number, y: number, z: number): void {
  c.add(clockRim, m.brass, transform(x, y, z + 0.02));
  c.add(clockFace, m.whiteGloss, transform(x, y, z + 0.04));
  c.box(m.black, x, y + 0.07, z + 0.05, 0.012, 0.15, 0.006);
  c.box(m.black, x + 0.05, y - 0.01, z + 0.05, 0.1, 0.012, 0.006);
}

export function buildWallItems(
  c: PartCollector, area: AreaLayout, m: Materials, dynamic: Group, out: WallScreens,
  accent: string, projectName: string, text: WorldText = worldText('pt-BR'),
): void {
  const zFace = (area.rect.y + WALL_ROWS) * T;
  const z = zFace + 0.03;
  let elevatorIndex = 0;
  for (const item of area.wallItems) {
    if (item.side !== 'north') continue;
    const a = item.x * T;
    const b = (item.x + item.w) * T;
    const mid = (a + b) / 2;
    placeNorthItem(c, area, m, dynamic, out, item, mid, b - a, z, zFace, accent, projectName, text, () => elevatorIndex++);
  }
}

function placeNorthItem(
  c: PartCollector, area: AreaLayout, m: Materials, dynamic: Group, out: WallScreens, item: WallItem, mid: number, width: number, z: number,
  zFace: number, accent: string, projectName: string, text: WorldText, nextElevator: () => number,
): void {
  const mk = (w: number, h: number): CanvasScreen => {
    const s = new CanvasScreen(Math.round(w * 256), Math.round(h * 256));
    out.all.push(s);
    return s;
  };
  switch (item.kind) {
    case 'elevator':
      elevatorCab(c, m, dynamic, mid - width / 2, mid + width / 2, zFace, nextElevator(), out.elevators);
      break;
    case 'logoSign': {
      c.box(m.brass, mid, 2.15, z + 0.02, 2.08, 0.58, 0.03);
      decorQuad(c, out, mid, 2.15, z + 0.045, 2.0, 0.5, (ctx, w, h) => paintSign(ctx, w, h, 'AI Office', '#c9a456', true), text);
      break;
    }
    case 'sign': {
      c.box(m.graphite, mid, 2.32, z + 0.02, 1.86, 0.48, 0.03);
      decorQuad(c, out, mid, 2.32, z + 0.045, 1.8, 0.42, (ctx, w, h) => paintSign(ctx, w, h, projectName, accent, true), text);
      break;
    }
    case 'board': {
      const s = mk(2.0, 1.12);
      out.board = s;
      framedScreen(c, m, dynamic, s, mid, 1.45, z, 2.0, 1.12);
      break;
    }
    case 'tv': {
      if (area.kind === 'meeting') {
        const s = mk(2.4, 1.35);
        out.meetingTv = s;
        framedScreen(c, m, dynamic, s, mid, 1.5, z, 2.4, 1.35);
      } else {
        const s = mk(2.0, 1.12);
        out.loungeTv = s;
        framedScreen(c, m, dynamic, s, mid, 1.45, z, 2.0, 1.12);
      }
      break;
    }
    case 'menu': {
      c.box(m.black, mid, 1.55, z + 0.02, 2.06, 1.06, 0.04);
      decorQuad(c, out, mid, 1.55, z + 0.045, 2.0, 1.0, paintMenu, text, true);
      break;
    }
    case 'whiteboard': {
      const s = mk(1.9, 1.05);
      out.whiteboard = s;
      c.box(m.steel, mid, 1.5, z + 0.02, 1.96, 1.11, 0.03);
      addScreen(dynamic, s, mid, 1.5, z + 0.045, 1.9, 1.05);
      break;
    }
    case 'poster': {
      c.box(m.walnutDark, mid, 1.65, z + 0.02, 0.88, 1.18, 0.03);
      decorQuad(c, out, mid, 1.65, z + 0.04, 0.8, 1.1, (ctx, w, h) => paintPoster(ctx, w, h, item.variant), text);
      break;
    }
    case 'clock':
      clock(c, m, mid, 2.2, z);
      break;
    case 'mirror':
      c.box(m.steel, mid, 1.55, z + 0.02, width * 0.6 + 0.06, 1.06, 0.03);
      c.box(m.mirror, mid, 1.55, z + 0.04, width * 0.6, 1.0, 0.01);
      break;
    default:
      break;
  }
}

export function disposeScreens(screens: WallScreens): void {
  for (const s of screens.all) s.dispose();
  screens.decor?.dispose();
}
