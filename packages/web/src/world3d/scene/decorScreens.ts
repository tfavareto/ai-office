// The pictures of the unlockable decoration in 3D: framed art and the neon sign on the walls, and the employee-of-the-month
// plaque on the reception desk. They are painted into the area's decor atlas when the area is built; the area is built
// again when the office unlocks something or the employee changes, so nothing here needs to repaint.
import { WALL_ROWS } from '../../layout/constants';
import { isDrawn } from '../../layout/decor';
import type { AreaLayout, FurnitureItem, WallItem } from '../../layout/types';
import type { Evolution } from '../../world/evolution';
import { type WorldText } from '../../i18n/world/translate';
import { TILE_M as T } from '../units';
import type { PartCollector } from '../util/parts';
import type { Materials } from './materials';
import { font, fitText } from './screens';
import { decorQuad, type WallScreens } from './wallItems';

const GOLD = '#e0b32e';
const NEON_CYAN = '#27e0e6';
const NEON_PINK = '#ff5fb2';
const NEON_GOLD = '#ffd24a';
const NEON_GOLD_SOFT = '#fff0a8';
const PLAQUE_W_M = 1.0;
const PLAQUE_H_M = 0.26;
/** Height of the plaque's centre on the desk front, and how far its picture floats off the marble. */
const PLAQUE_Y_M = 0.56;
const DESK_FRONT_M = 0.4875 + 0.02;
const FRAME_Y_M = 1.65;
const MAX_NAME_CHARS = 14;

const SKY = ['#f2c46d', '#cde7c2', '#f2a3c4'] as const;

export function paintArt(ctx: CanvasRenderingContext2D, w: number, h: number, variant: number): void {
  const v = variant % 3;
  ctx.fillStyle = '#f3efe6';
  ctx.fillRect(0, 0, w, h);
  const m = Math.round(w * 0.1);
  const x = m;
  const y = m;
  const iw = w - m * 2;
  const ih = h - m * 2;
  ctx.fillStyle = SKY[v];
  ctx.fillRect(x, y, iw, ih);
  if (v === 0) {
    ctx.fillStyle = '#e0795a';
    ctx.beginPath();
    ctx.arc(x + iw * 0.7, y + ih * 0.3, ih * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b7a46';
    ctx.fillRect(x, y + ih * 0.7, iw, ih * 0.3);
    ctx.fillStyle = '#4f9559';
    ctx.fillRect(x + iw * 0.1, y + ih * 0.6, iw * 0.45, ih * 0.12);
  } else if (v === 1) {
    ctx.fillStyle = '#2f6fed';
    ctx.fillRect(x, y + ih * 0.5, iw, ih * 0.5);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++)
      ctx.fillRect(x + iw * (0.1 + i * 0.22), y + ih * (0.2 + (i % 2) * 0.08), iw * 0.14, ih * 0.04);
    ctx.fillStyle = '#1d3a63';
    ctx.fillRect(x + iw * 0.65, y + ih * 0.68, iw * 0.22, ih * 0.1);
  } else {
    ctx.fillStyle = '#8a5ad6';
    ctx.fillRect(x, y, iw * 0.5, ih);
    ctx.fillStyle = '#2a2f3a';
    ctx.beginPath();
    ctx.arc(x + iw * 0.72, y + ih * 0.35, ih * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(242,163,196,0.85)';
    for (let i = 0; i < 6; i++) ctx.fillRect(x + iw * 0.1, y + ih * (0.1 + i * 0.14), iw * 0.8, ih * 0.05);
  }
}

export function paintNeon(ctx: CanvasRenderingContext2D, w: number, h: number, gold: boolean): void {
  ctx.fillStyle = '#0a0c12';
  ctx.fillRect(0, 0, w, h);
  const a = gold ? NEON_GOLD : NEON_CYAN;
  const b = gold ? NEON_GOLD_SOFT : NEON_PINK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(Math.round(h * 0.46), 800);
  for (const [blur, alpha] of [
    [26, 0.55],
    [12, 0.9],
    [0, 1],
  ] as const) {
    ctx.shadowColor = a;
    ctx.shadowBlur = blur;
    ctx.fillStyle = blur === 0 ? '#eaffff' : a;
    ctx.globalAlpha = alpha;
    ctx.fillText('AI OFFICE', w / 2, h * 0.4);
  }
  ctx.globalAlpha = 1;
  ctx.shadowColor = b;
  ctx.shadowBlur = 16;
  ctx.strokeStyle = b;
  ctx.lineWidth = Math.max(3, h * 0.045);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.78);
  ctx.lineTo(w * 0.88, h * 0.78);
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** The name as it is written on the plate (long names are cut with an ellipsis). */
export function plaqueLabel(name: string): string {
  const flat = name.replace(/[^\p{L}\p{N}.\-' ]/gu, '').trim();
  return flat.length <= MAX_NAME_CHARS ? flat : `${flat.slice(0, MAX_NAME_CHARS - 1)}…`;
}

export function paintPlaque(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  name: string | null,
  gold: boolean,
): void {
  const metal = gold ? GOLD : '#c9a456';
  const rim = gold ? '#9a7412' : '#7d5f22';
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = metal;
  ctx.fillRect(3, 3, w - 6, h - 6);
  ctx.fillStyle = '#1f1612';
  ctx.fillRect(Math.round(h * 0.16), Math.round(h * 0.16), w - Math.round(h * 0.32), h - Math.round(h * 0.32));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = gold ? '#fff0a8' : '#f2dc96';
  ctx.font = font(Math.round(h * 0.52), 700);
  if (name === null || name === '') {
    ctx.fillRect(w * 0.3, h * 0.5, w * 0.4, Math.max(2, h * 0.04));
    return;
  }
  ctx.fillText(fitText(ctx, `★ ${plaqueLabel(name)} ★`, w - h * 0.5), w / 2, h * 0.53);
}

function frameMetal(m: Materials, gold: boolean): ReturnType<Materials['solid']> {
  return gold ? m.solid(GOLD, 0.25, 1) : m.brass;
}

function hangFrame(
  c: PartCollector,
  m: Materials,
  out: WallScreens,
  item: WallItem,
  zWall: number,
  gold: boolean,
  text: WorldText,
): void {
  const mid = (item.x + item.w / 2) * T;
  const fw = item.w === 1 ? 0.56 : 1.22;
  const fh = item.w === 1 ? 0.74 : 0.84;
  const z = zWall + 0.03;
  c.box(frameMetal(m, gold), mid, FRAME_Y_M, z + 0.01, fw + 0.1, fh + 0.1, 0.035);
  decorQuad(c, out, mid, FRAME_Y_M, z + 0.032, fw, fh, (ctx, w, h) => paintArt(ctx, w, h, item.variant), text);
}

function hangNeon(
  c: PartCollector,
  m: Materials,
  out: WallScreens,
  item: WallItem,
  zWall: number,
  gold: boolean,
  text: WorldText,
): void {
  const mid = (item.x + item.w / 2) * T;
  const width = item.w * T - 0.18;
  const z = zWall + 0.03;
  c.box(m.black, mid, 1.85, z + 0.01, width + 0.08, 0.66, 0.04);
  decorQuad(c, out, mid, 1.85, z + 0.035, width, 0.58, (ctx, w, h) => paintNeon(ctx, w, h, gold), text);
}

function placePlaque(
  c: PartCollector,
  out: WallScreens,
  item: FurnitureItem,
  evolution: Evolution,
  text: WorldText,
): void {
  const x = (item.x + item.w / 2) * T;
  // the plaque's tile row is the lower half of the desk: the desk's centre is its top edge
  const z = item.y * T + DESK_FRONT_M;
  const gold = evolution.decor.has('goldFinish');
  decorQuad(
    c,
    out,
    x,
    PLAQUE_Y_M,
    z,
    PLAQUE_W_M,
    PLAQUE_H_M,
    (ctx, w, h) => paintPlaque(ctx, w, h, evolution.employee, gold),
    text,
  );
}

/** Hangs the unlocked pictures of an area: framed art, the neon sign and the plaque on the reception desk. */
export function buildDecorWall(
  c: PartCollector,
  area: AreaLayout,
  m: Materials,
  out: WallScreens,
  evolution: Evolution,
  text: WorldText,
): void {
  const zWall = (area.rect.y + WALL_ROWS) * T;
  const gold = evolution.decor.has('goldFinish');
  for (const item of area.wallItems) {
    if (item.decor === undefined || item.side !== 'north' || !isDrawn(item, evolution.decor)) continue;
    if (item.kind === 'frame') hangFrame(c, m, out, item, zWall, gold, text);
    else if (item.kind === 'neon') hangNeon(c, m, out, item, zWall, gold, text);
  }
  for (const item of area.furniture)
    if (item.kind === 'plaque' && item.decor !== undefined && isDrawn(item, evolution.decor))
      placePlaque(c, out, item, evolution, text);
}
