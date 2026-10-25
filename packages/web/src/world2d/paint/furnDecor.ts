// Pixel-art painters of the unlockable decoration: the aquarium, the trophy cabinet with its cups, the employee-of-the-month
// plaque on the reception desk, the neon sign and framed art on the walls, the garland of the corridor and the extra
// arcade machines. Sprites follow the other furniture: painted at the footprint's top-left, `rise` px above it.
import type { Evolution, CupTier } from '../../world/evolution';
import type { FurnitureItem, WallItem } from '../../layout/types';
import { shade } from '../color';
import { GLYPH_H, drawPixelText, foldText, textWidth } from '../font';
import { BRASS, EBONY, GRAPHITE, PLANT, WALNUT } from '../palette';
import { type Ctx, bevel, disc, hline, makeCanvas, pixel, context2d, rect, vline } from './ctx';

const T = 16;
const GOLD = { dark: '#9a7412', base: '#e0b32e', light: '#f6d764', hi: '#fff0a8' } as const;
const CUP_COLORS: Record<CupTier, { base: string; light: string; dark: string }> = {
  bronze: { base: '#b9773e', light: '#e0a066', dark: '#7d4a22' },
  silver: { base: '#c9d2dc', light: '#f2f6fa', dark: '#8995a3' },
  gold: { base: '#f2c94c', light: '#fff0a8', dark: '#a8801a' },
};

/** The trim of the cabinet and the plaque: brass, or gold once the office reaches the last level. */
function trim(evolution: Evolution): { dark: string; base: string; light: string; hi: string } {
  return evolution.decor.has('goldFinish') ? GOLD : BRASS;
}

// --- aquarium ----------------------------------------------------------------------------------------------------------

export const AQUARIUM_RISE = 14;
/** Water area of the aquarium sprite (px from the footprint's top-left), for the fish that swim in it. */
export const AQUARIUM_WATER = { x: 3, y: -9, w: 26, h: 13 } as const;

export function aquarium(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * T;
  // stand
  rect(ctx, 1, 6, w - 2, 10, WALNUT.base);
  hline(ctx, 1, 6, w - 2, WALNUT.hi);
  rect(ctx, 1, 15, w - 2, 1, '#0c0908');
  vline(ctx, Math.floor(w / 2), 7, 8, WALNUT.dark);
  rect(ctx, 5, 9, 6, 1, BRASS.light);
  rect(ctx, w - 11, 9, 6, 1, BRASS.light);
  // tank
  rect(ctx, 0, -12, w, 19, GRAPHITE.deep);
  bevel(ctx, 1, -11, w - 2, 17, '#17617d', '#3aa7c4', '#0e3d52');
  const water = AQUARIUM_WATER;
  const top = ctx.createLinearGradient(0, water.y, 0, water.y + water.h);
  top.addColorStop(0, '#46b6d0');
  top.addColorStop(1, '#16587a');
  ctx.fillStyle = top;
  ctx.fillRect(water.x, water.y, water.w, water.h);
  rect(ctx, water.x, water.y + water.h - 3, water.w, 3, '#d9c58f');
  for (let x = water.x; x < water.x + water.w; x += 2) pixel(ctx, x, water.y + water.h - 3 + ((x * 7) % 2), '#b9a46f');
  // plants and a rock
  for (const [px, tall] of [
    [5, 6],
    [8, 4],
    [22, 5],
    [25, 7],
  ] as const) {
    vline(ctx, px, water.y + water.h - 3 - tall, tall, PLANT.base);
    pixel(ctx, px + 1, water.y + water.h - 3 - tall + 1, PLANT.light);
  }
  rect(ctx, 14, water.y + water.h - 5, 5, 3, '#7a7f87');
  rect(ctx, 15, water.y + water.h - 6, 3, 1, '#9aa0a8');
  // lid, light strip and glass glint
  rect(ctx, 0, -14, w, 3, GRAPHITE.mid);
  hline(ctx, 0, -14, w, GRAPHITE.hi);
  rect(ctx, 3, -12, w - 6, 1, '#f4f8ff');
  rect(ctx, 5, -9, 1, 9, 'rgba(255,255,255,0.35)');
  rect(ctx, 7, -9, 1, 4, 'rgba(255,255,255,0.2)');
}

// --- trophy cabinet ----------------------------------------------------------------------------------------------------

export const CABINET_RISE = 26;
const CUPS_PER_SHELF = 4;

function cup(ctx: Ctx, x: number, y: number, tier: CupTier): void {
  const c = CUP_COLORS[tier];
  rect(ctx, x + 1, y - 5, 5, 3, c.base);
  hline(ctx, x + 1, y - 5, 5, c.light);
  pixel(ctx, x, y - 4, c.dark);
  pixel(ctx, x + 6, y - 4, c.dark);
  rect(ctx, x + 2, y - 2, 3, 1, c.base);
  vline(ctx, x + 3, y - 1, 1, c.dark);
  rect(ctx, x + 1, y, 5, 1, c.dark);
}

/** The cabinet is painted once per set of cups: the sprite is cached by `trophyKey`. */
export function trophyCabinet(ctx: Ctx, it: FurnitureItem, evolution: Evolution): void {
  const w = it.w * T;
  const metal = trim(evolution);
  rect(ctx, 0, -CABINET_RISE, w, CABINET_RISE + T, WALNUT.base);
  hline(ctx, 0, -CABINET_RISE, w, WALNUT.hi);
  rect(ctx, 0, T - 2, w, 2, WALNUT.dark);
  // crown moulding and back panel
  rect(ctx, 0, -CABINET_RISE, w, 2, metal.base);
  hline(ctx, 0, -CABINET_RISE, w, metal.hi);
  rect(ctx, 2, -CABINET_RISE + 3, w - 4, CABINET_RISE + 5, '#1b1410');
  rect(ctx, 3, -CABINET_RISE + 4, w - 6, 1, '#2d221b');
  // two shelves with a soft spotlight each
  for (const shelf of [-6, 5]) {
    rect(ctx, 2, shelf, w - 4, 1, WALNUT.light);
    rect(ctx, 2, shelf + 1, w - 4, 1, WALNUT.dark);
    rect(ctx, 4, shelf - 11, w - 8, 1, 'rgba(255,236,170,0.18)');
  }
  evolution.cups.forEach((tier, index) => {
    const shelf = index < CUPS_PER_SHELF ? -6 : 5;
    const slot = index % CUPS_PER_SHELF;
    cup(ctx, 3 + slot * 7, shelf, tier);
  });
  // glass front with a diagonal glint, door seam and a small brass knob
  rect(ctx, 2, -CABINET_RISE + 3, w - 4, CABINET_RISE + 5, 'rgba(190,225,240,0.13)');
  for (let i = 0; i < 9; i++) pixel(ctx, 6 + i, -CABINET_RISE + 6 + i, 'rgba(255,255,255,0.35)');
  for (let i = 0; i < 5; i++) pixel(ctx, 17 + i, -CABINET_RISE + 6 + i, 'rgba(255,255,255,0.2)');
  vline(ctx, Math.floor(w / 2), -CABINET_RISE + 3, CABINET_RISE + 5, metal.dark);
  rect(ctx, Math.floor(w / 2) - 2, 1, 1, 3, metal.light);
  rect(ctx, Math.floor(w / 2) + 1, 1, 1, 3, metal.light);
  // a tiny plate under the glass
  rect(ctx, Math.floor(w / 2) - 5, 8, 10, 3, metal.dark);
  hline(ctx, Math.floor(w / 2) - 5, 8, 10, metal.light);
}

export function trophyKey(evolution: Evolution): string {
  return `${evolution.cups.join(',')}|${evolution.decor.has('goldFinish') ? 'gold' : 'brass'}`;
}

// --- plaque ---------------------------------------------------------------------------------------------------------------

/** The plate sits right of the brass "AI OFFICE" one: 34 px, room for seven letters of the 3x5 font. */
export const PLAQUE_PLATE = { x: 12, y: 1, w: 34, h: 10 } as const;
const PLAQUE_MAX_CHARS = 7;
/** Short names get a star on each side, like a badge. */
const STAR_MAX_CHARS = 5;

/** The name as it fits the plate in the 3x5 font. */
export function plaqueName(name: string): string {
  const folded = foldText(name)
    .replace(/[^A-Z0-9 .'-]/g, '')
    .trim();
  if (folded.length <= PLAQUE_MAX_CHARS) return folded;
  return `${folded.slice(0, PLAQUE_MAX_CHARS - 1)}.`;
}

/** What the plate says: the name, between two stars when it is short. */
export function plaqueText(name: string): string {
  const fitted = plaqueName(name);
  return fitted.length <= STAR_MAX_CHARS ? `*${fitted}*` : fitted;
}

export function plaque(ctx: Ctx, evolution: Evolution): void {
  const metal = trim(evolution);
  const p = PLAQUE_PLATE;
  rect(ctx, p.x, p.y, p.w, p.h, metal.dark);
  bevel(ctx, p.x, p.y, p.w, p.h, metal.base, metal.light, metal.dark);
  rect(ctx, p.x + 2, p.y + 2, p.w - 4, p.h - 4, EBONY.base);
  hline(ctx, p.x + 2, p.y + 2, p.w - 4, EBONY.mid);
  const text = evolution.employee === null ? '' : plaqueText(evolution.employee);
  if (text === '') {
    rect(ctx, p.x + 9, p.y + 4, 16, 1, metal.dark);
    return;
  }
  const x = p.x + Math.floor((p.w - textWidth(text)) / 2);
  drawPixelText(ctx, text, x, p.y + Math.floor((p.h - GLYPH_H) / 2), metal.hi);
}

// --- arcade ---------------------------------------------------------------------------------------------------------------

const ARCADE_NEON = ['#ffb02e', '#8f6bff'] as const;

/** The two extra machines of the lounge: the same cabinet as the first two, in amber and violet. */
export function arcade(ctx: Ctx, it: FurnitureItem): void {
  const neon = ARCADE_NEON[it.variant % 2];
  rect(ctx, 1, -14, 14, 30, GRAPHITE.deep);
  vline(ctx, 1, -14, 30, GRAPHITE.mid);
  vline(ctx, 14, -14, 30, '#0a0b0e');
  rect(ctx, 2, -13, 12, 4, neon);
  drawPixelText(ctx, 'AI', 6, -12, '#0b1020');
  bevel(ctx, 3, -8, 10, 9, '#0b1322', '#2a3a5a', '#05080f');
  rect(ctx, 4, -7, 8, 7, '#150f3a');
  rect(ctx, 6, -6, 2, 2, '#ffffff');
  rect(ctx, 8, -3, 3, 1, neon);
  rect(ctx, 2, 3, 12, 3, GRAPHITE.mid);
  disc(ctx, 5, 4, 1, '#3ecf8e');
  disc(ctx, 11, 4, 1, '#ff6a5a');
  rect(ctx, 2, 7, 12, 9, shade(neon, -0.55));
  vline(ctx, 2, 7, 9, neon);
}

// --- garland of the corridor ---------------------------------------------------------------------------------------------

export const LIGHTS_BULBS = ['#ffd98a', '#ff9d7a', '#8fe3ea', '#ffe9b0', '#c6a8ff'] as const;
const LIGHTS_SAG = 4;
const LIGHTS_STEP = 8;

/** Where the bulbs of a garland segment hang (px from the segment's left edge), shared by the sprite and the night glow. */
export function bulbPositions(widthPx: number, variant: number): { x: number; y: number; color: string }[] {
  const bulbs: { x: number; y: number; color: string }[] = [];
  for (let x = LIGHTS_STEP / 2; x < widthPx; x += LIGHTS_STEP) {
    const t = (x / widthPx) * 2 - 1;
    const y = 3 + Math.round(LIGHTS_SAG * (1 - t * t));
    bulbs.push({ x, y, color: LIGHTS_BULBS[(Math.floor(x / LIGHTS_STEP) + variant) % LIGHTS_BULBS.length] });
  }
  return bulbs;
}

export function lights(ctx: Ctx, it: FurnitureItem): void {
  const w = it.w * T;
  for (let x = 0; x < w; x++) {
    const t = (x / w) * 2 - 1;
    pixel(ctx, x, 2 + Math.round(LIGHTS_SAG * (1 - t * t)), '#2a2d33');
  }
  for (const bulb of bulbPositions(w, it.variant)) {
    rect(ctx, bulb.x, bulb.y + 1, 2, 3, bulb.color);
    pixel(ctx, bulb.x, bulb.y + 1, '#ffffff');
    pixel(ctx, bulb.x, bulb.y, '#2a2d33');
  }
}

// --- wall pieces ------------------------------------------------------------------------------------------------------------

const ART_SKY = ['#f2c46d', '#cde7c2', '#f2a3c4'] as const;

function wallFrame(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  metal: string,
  lightMetal: string,
  darkMetal: string,
): void {
  rect(ctx, x, y, w, h, darkMetal);
  bevel(ctx, x, y, w, h, metal, lightMetal, darkMetal);
  rect(ctx, x + 2, y + 2, w - 4, h - 4, '#f3efe6');
}

/** A framed picture: an abstract landscape, a different one for each variant. */
export function frame(ctx: Ctx, localX: number, item: WallItem, gold: boolean): void {
  const metal = gold ? GOLD : BRASS;
  const px = localX * T + (item.w === 1 ? 2 : 4);
  const pw = item.w * T - (item.w === 1 ? 4 : 8);
  const ph = item.w === 1 ? 17 : 15;
  const py = item.w === 1 ? 8 : 9;
  wallFrame(ctx, px, py, pw, ph, metal.base, metal.light, metal.dark);
  const ix = px + 3;
  const iy = py + 3;
  const iw = pw - 6;
  const ih = ph - 6;
  const v = item.variant % 3;
  rect(ctx, ix, iy, iw, ih, ART_SKY[v]);
  if (v === 0) {
    disc(ctx, ix + Math.floor(iw * 0.7), iy + 3, 2, '#e0795a');
    rect(ctx, ix, iy + ih - 4, iw, 4, '#3b7a46');
    rect(ctx, ix + 2, iy + ih - 6, Math.floor(iw / 2), 2, '#4f9559');
  } else if (v === 1) {
    rect(ctx, ix, iy + Math.floor(ih / 2), iw, Math.ceil(ih / 2), '#2f6fed');
    for (let i = 0; i < 4; i++) rect(ctx, ix + 2 + i * 4, iy + 2 + (i % 2), 3, 1, '#ffffff');
    rect(ctx, ix + iw - 7, iy + ih - 6, 5, 2, '#1d3a63');
  } else {
    rect(ctx, ix, iy, Math.floor(iw / 2), ih, '#8a5ad6');
    disc(ctx, ix + iw - 5, iy + 4, 3, '#2a2f3a');
    for (let i = 0; i < ih; i += 3) hline(ctx, ix + 2, iy + i, iw - 4, shade('#f2a3c4', -0.1 * (i % 2)));
  }
  hline(ctx, px + 2, py + ph - 1, pw - 4, metal.dark);
}

/** The neon "AI OFFICE" sign: tubes in cyan and pink on a dark board. Its glow at night is added by the lighting pass. */
export function neon(ctx: Ctx, localX: number, item: WallItem, gold: boolean): void {
  const px = localX * T + 2;
  const pw = item.w * T - 4;
  const py = 8;
  rect(ctx, px, py, pw, 17, '#0a0c12');
  bevel(ctx, px, py, pw, 17, '#10131b', '#2a2f3a', '#05060a');
  const a = gold ? '#ffd24a' : '#27e0e6';
  const b = gold ? '#fff0a8' : '#ff5fb2';
  const label = 'AI OFFICE';
  const tw = textWidth(label);
  const tx = px + Math.floor((pw - tw) / 2);
  // each glyph pixel is a tube segment: a bright core over a dim halo
  drawPixelText(ctx, label, tx, py + 3, shade(a, -0.55));
  drawPixelText(ctx, label, tx, py + 2, a);
  hline(ctx, px + 4, py + 10, pw - 8, shade(b, -0.5));
  hline(ctx, px + 4, py + 9, pw - 8, b);
  rect(ctx, px + 3, py + 12, 2, 2, b);
  rect(ctx, px + pw - 5, py + 12, 2, 2, a);
  for (let x = px + 8; x < px + pw - 8; x += 6) pixel(ctx, x, py + 13, shade(a, -0.3));
}

/** Pixel rect of the neon tubes' glow in the sign (px inside the item), for the night pass. */
export function neonGlowRect(localX: number, item: WallItem): { x: number; y: number; w: number; h: number } {
  return { x: localX * T + 2, y: 8, w: item.w * T - 4, h: 17 };
}

// --- sprite cache -----------------------------------------------------------------------------------------------------------

const cache = new Map<string, HTMLCanvasElement>();

export const DECOR_RISE: Partial<Record<FurnitureItem['kind'], number>> = {
  aquarium: AQUARIUM_RISE,
  trophyCabinet: CABINET_RISE,
  plaque: 0,
  lights: 6,
  arcade: 14,
};

export function decorRise(kind: FurnitureItem['kind']): number {
  return DECOR_RISE[kind] ?? 0;
}

function paint(item: FurnitureItem, evolution: Evolution): { key: string; draw: (ctx: Ctx) => void } | null {
  const gold = evolution.decor.has('goldFinish') ? 'gold' : 'brass';
  switch (item.kind) {
    case 'aquarium':
      return { key: `aquarium|${item.w}`, draw: (ctx) => aquarium(ctx, item) };
    case 'trophyCabinet':
      return { key: `cabinet|${item.w}|${trophyKey(evolution)}`, draw: (ctx) => trophyCabinet(ctx, item, evolution) };
    case 'plaque':
      return {
        key: `plaque|${gold}|${evolution.employee === null ? '' : plaqueText(evolution.employee)}`,
        draw: (ctx) => plaque(ctx, evolution),
      };
    case 'arcade':
      return { key: `arcade|${item.variant}`, draw: (ctx) => arcade(ctx, item) };
    case 'lights':
      return { key: `lights|${item.w}|${item.variant}`, draw: (ctx) => lights(ctx, item) };
    default:
      return null;
  }
}

export interface DecorSprite {
  canvas: HTMLCanvasElement;
}

/** The sprite of a piece of decoration for the current evolution (cached by what it shows), or null for other kinds. */
export function decorSprite(item: FurnitureItem, evolution: Evolution): DecorSprite | null {
  const painted = paint(item, evolution);
  if (painted === null) return null;
  let canvas = cache.get(painted.key);
  if (canvas === undefined) {
    const rise = decorRise(item.kind);
    canvas = makeCanvas(item.w * T, item.h * T + rise);
    const ctx = context2d(canvas);
    ctx.translate(0, rise);
    painted.draw(ctx);
    cache.set(painted.key, canvas);
  }
  return { canvas };
}
