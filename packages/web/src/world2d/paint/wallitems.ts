import type { WallItem } from '../../layout/types';
import { type WorldText, worldText } from '../../i18n/world/translate';
import { drawPixelText, textWidth } from '../font';
import { rgba, shade } from '../color';
import { BRASS, EBONY, GRAPHITE, LED, MARBLE, WALNUT } from '../palette';
import { BASE_EVOLUTION, type Evolution } from '../../world/evolution';
import { frame as artFrame, neon as neonSign } from './furnDecor';
import { type Ctx, bevel, disc, hline, pixel, rect, vline } from './ctx';

const T = 16;

export interface WallItemFrame {
  /** Pixel rect of the dynamic screen area inside the item, relative to the item's top-left corner (null when static). */
  screen: { x: number; y: number; w: number; h: number } | null;
}

/** Highest y (px from the wall top) any wall item reaches; the room pills stay above it so they never cover one. */
export const WALL_ITEMS_TOP = 4;

/** y (px from the wall top) where wall items hang. */
export const ITEM_Y = 12;

function frame(ctx: Ctx, x: number, y: number, w: number, h: number, base: string): void {
  rect(ctx, x, y, w, h, shade(base, -0.45));
  bevel(ctx, x, y, w, h, base, shade(base, 0.35), shade(base, -0.4));
}

function fitName(text: string, maxChars: number): string {
  const flat = text.replace(/[^\p{L}\p{N}.\-_ ]/gu, '').trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars - 1)}.`;
}

function sign(ctx: Ctx, x: number, w: number, label: string, accent: string): void {
  const px = x * T;
  const pw = w * T;
  const y = ITEM_Y;
  frame(ctx, px + 2, y, pw - 4, 11, BRASS.base);
  rect(ctx, px + 4, y + 2, pw - 8, 7, EBONY.base);
  hline(ctx, px + 4, y + 2, pw - 8, EBONY.mid);
  const text = fitName(label, Math.floor((pw - 18) / 4));
  rect(ctx, px + 5, y + 3, 3, 5, accent);
  rect(ctx, px + 5, y + 3, 3, 1, shade(accent, 0.45));
  drawPixelText(ctx, text, px + 10, y + 3, BRASS.hi);
}

function logoSign(ctx: Ctx, x: number, w: number): void {
  const px = x * T;
  const pw = w * T;
  frame(ctx, px + 1, 6, pw - 2, 22, BRASS.base);
  rect(ctx, px + 3, 8, pw - 6, 18, GRAPHITE.deep);
  hline(ctx, px + 3, 8, pw - 6, GRAPHITE.base);
  // brand logo: blue rounded square with a tower glyph
  const lx = px + Math.floor(pw / 2) - 5;
  rect(ctx, lx + 1, 10, 9, 9, '#2f6fed');
  rect(ctx, lx, 11, 11, 7, '#2f6fed');
  rect(ctx, lx + 1, 10, 9, 1, '#5b93ff');
  rect(ctx, lx + 4, 12, 3, 6, '#eaf2ff');
  rect(ctx, lx + 3, 14, 5, 4, '#eaf2ff');
  rect(ctx, lx + 5, 11, 1, 1, '#eaf2ff');
  pixel(ctx, lx + 5, 15, '#2f6fed');
  pixel(ctx, lx + 5, 13, '#2f6fed');
  const label = 'AI OFFICE';
  drawPixelText(ctx, label, px + Math.floor((pw - textWidth(label)) / 2), 21, BRASS.hi);
}

function board(ctx: Ctx, x: number, w: number, accent: string): WallItemFrame {
  const px = x * T + 2;
  const pw = w * T - 4;
  frame(ctx, px, ITEM_Y, pw, 11, GRAPHITE.base);
  rect(ctx, px + 2, ITEM_Y + 2, pw - 4, 7, '#0b1322');
  rect(ctx, px + 2, ITEM_Y + 2, 1, 7, accent);
  pixel(ctx, px + pw - 2, ITEM_Y + 10, LED.teal);
  return { screen: { x: px + 2, y: ITEM_Y + 2, w: pw - 4, h: 7 } };
}

function tv(ctx: Ctx, x: number, w: number, big: boolean): WallItemFrame {
  const px = x * T + 2;
  const pw = w * T - 4;
  const h = big ? 26 : 18;
  const y = big ? WALL_ITEMS_TOP : 9;
  frame(ctx, px, y, pw, h, EBONY.base);
  rect(ctx, px + 2, y + 2, pw - 4, h - 4, '#08101d');
  hline(ctx, px + 2, y + 2, pw - 4, '#16233a');
  rect(ctx, px + Math.floor(pw / 2) - 3, y + h, 6, 1, GRAPHITE.mid);
  return { screen: { x: px + 2, y: y + 2, w: pw - 4, h: h - 4 } };
}

/** Horizontal placement of the pantry menu's words (px inside the board), computed apart from drawing so it can be tested. */
export interface MenuLayout {
  title: { text: string; x: number };
  rows: { label: string; labelX: number; price: string; priceX: number }[];
}

const MENU_PAD = 5;

export function menuLayout(pw: number, text: WorldText): MenuLayout {
  const title = text.t('menu2d.title');
  const row = (labelKey: 'menu2d.coffee' | 'menu2d.juice', priceKey: 'menu2d.coffeePrice' | 'menu2d.juicePrice') => {
    const price = text.t(priceKey);
    return { label: text.t(labelKey), labelX: MENU_PAD, price, priceX: pw - 1 - MENU_PAD - textWidth(price) };
  };
  return {
    title: { text: title, x: Math.floor((pw - textWidth(title)) / 2) },
    rows: [row('menu2d.coffee', 'menu2d.coffeePrice'), row('menu2d.juice', 'menu2d.juicePrice')],
  };
}

function menu(ctx: Ctx, x: number, w: number, text: WorldText): void {
  const px = x * T + 1;
  const pw = w * T - 2;
  frame(ctx, px, 7, pw, 21, WALNUT.base);
  rect(ctx, px + 2, 9, pw - 4, 17, '#1f2a24');
  hline(ctx, px + 2, 9, pw - 4, '#2d3b33');
  const chalk = '#e8efe6';
  const layout = menuLayout(pw, text);
  drawPixelText(ctx, layout.title.text, px + layout.title.x, 11, BRASS.hi);
  hline(ctx, px + 5, 17, pw - 10, rgba(chalk, 0.4));
  layout.rows.forEach((row, i) => {
    const y = i === 0 ? 19 : 23;
    drawPixelText(ctx, row.label, px + row.labelX, y, chalk);
    drawPixelText(ctx, row.price, px + row.priceX, y, BRASS.light);
  });
}

/** Frame of the meeting-room whiteboard (px from the wall top): the live task board is drawn inside it. */
export const WHITEBOARD = { y: 5, h: 24 } as const;

function whiteboard(ctx: Ctx, x: number, w: number): WallItemFrame {
  const px = x * T + 1;
  const pw = w * T - 2;
  frame(ctx, px, WHITEBOARD.y, pw, WHITEBOARD.h, GRAPHITE.light);
  rect(ctx, px + 2, WHITEBOARD.y + 2, pw - 4, WHITEBOARD.h - 4, '#f3f5f6');
  hline(ctx, px + 2, WHITEBOARD.y + 2, pw - 4, '#ffffff');
  return { screen: { x: px + 2, y: WHITEBOARD.y + 2, w: pw - 4, h: WHITEBOARD.h - 4 } };
}

function elevator(ctx: Ctx, x: number, w: number): void {
  const px = x * T;
  const pw = w * T;
  rect(ctx, px - 3, 4, pw + 6, 28, BRASS.dark);
  rect(ctx, px - 2, 5, pw + 4, 27, BRASS.base);
  hline(ctx, px - 2, 5, pw + 4, BRASS.hi);
  rect(ctx, px, 8, pw, 24, '#0e1117');
  rect(ctx, px + Math.floor(pw / 2) - 6, 5, 12, 3, GRAPHITE.deep);
  pixel(ctx, px + Math.floor(pw / 2) - 4, 6, LED.teal);
  pixel(ctx, px + Math.floor(pw / 2) + 3, 6, '#ff6a5a');
  // call buttons
  rect(ctx, px + pw + 3, 20, 2, 3, BRASS.light);
}

function mirror(ctx: Ctx, x: number, w: number): void {
  const px = x * T + 1;
  const pw = w * T - 2;
  frame(ctx, px, 6, pw, 21, BRASS.base);
  rect(ctx, px + 2, 8, pw - 4, 17, '#b9dbe6');
  for (let i = 0; i < pw - 8; i += 9) {
    for (let k = 0; k < 6; k++) pixel(ctx, px + 4 + i + k, 10 + k, '#e9f6fa');
  }
  hline(ctx, px + 2, 24, pw - 4, '#8bb8c8');
}

function poster(ctx: Ctx, x: number, w: number, variant: number): void {
  const px = x * T + Math.floor((w * T - 20) / 2);
  frame(ctx, px, 12, 20, 11, WALNUT.base);
  const palettes = [
    ['#e0795a', '#f2c46d', '#2f6fed'],
    ['#3b8a52', '#cde7c2', '#1d3a63'],
    ['#8a5ad6', '#f2a3c4', '#2a2f3a'],
  ];
  const [a, b, c] = palettes[variant % 3];
  rect(ctx, px + 2, 14, 16, 7, b);
  rect(ctx, px + 2, 14, 8, 7, a);
  disc(ctx, px + 13, 17, 2, c);
  hline(ctx, px + 2, 20, 16, shade(c, -0.2));
}

function clock(ctx: Ctx, x: number, w: number): void {
  const cx = x * T + Math.floor((w * T) / 2);
  disc(ctx, cx, 17, 5, BRASS.dark);
  disc(ctx, cx, 17, 4, BRASS.base);
  disc(ctx, cx, 17, 3, MARBLE.light);
  vline(ctx, cx, 15, 3, GRAPHITE.deep);
  hline(ctx, cx, 17, 2, GRAPHITE.deep);
}

/** Paint a static wall decoration. Returns the dynamic screen rect, if any. */
export function paintWallItem(
  ctx: Ctx,
  item: WallItem,
  localX: number,
  label: string,
  accent: string,
  text: WorldText = worldText('pt-BR'),
  evolution: Evolution = BASE_EVOLUTION,
): WallItemFrame {
  switch (item.kind) {
    case 'sign':
      sign(ctx, localX, item.w, label, accent);
      return { screen: null };
    case 'logoSign':
      logoSign(ctx, localX, item.w);
      return { screen: null };
    case 'board':
      return board(ctx, localX, item.w, accent);
    case 'tv':
      return tv(ctx, localX, item.w, item.w >= 6);
    case 'menu':
      menu(ctx, localX, item.w, text);
      return { screen: null };
    case 'whiteboard':
      return whiteboard(ctx, localX, item.w);
    case 'elevator':
      elevator(ctx, localX, item.w);
      return { screen: null };
    case 'mirror':
      mirror(ctx, localX, item.w);
      return { screen: null };
    case 'poster':
      poster(ctx, localX, item.w, item.variant);
      return { screen: null };
    case 'clock':
      clock(ctx, localX, item.w);
      return { screen: null };
    case 'frame':
      artFrame(ctx, localX, item, evolution.decor.has('goldFinish'));
      return { screen: null };
    case 'neon':
      neonSign(ctx, localX, item, evolution.decor.has('goldFinish'));
      return { screen: null };
    default:
      return { screen: null };
  }
}
