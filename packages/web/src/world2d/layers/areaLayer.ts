import type { Locale } from '@ai-office/shared';
import { type WorldText, worldText } from '../../i18n/world/translate';
import type { AreaLayout, FurnitureItem, Rect } from '../../layout/types';
import { TILE } from '../../layout/constants';
import { type Ctx, context2d, ellipse, makeCanvas } from '../paint/ctx';
import { furnitureSprite, spriteRise } from '../paint/furniture';
import { rugFill } from '../paint/furnOffice';
import { paintFloorTile } from '../paint/floors';
import { paintDoors, paintLedge, paintSideWall, paintWall } from '../paint/walls';
import { type WallItemFrame, paintWallItem } from '../paint/wallitems';
import { WALL_ROWS } from '../../layout/constants';

/** Furniture item with its sprite placement in world pixels. */
export interface PlacedItem {
  item: FurnitureItem;
  sprite: HTMLCanvasElement;
  /** Top-left of the sprite in world px. */
  x: number;
  y: number;
  /** Bottom edge of the footprint in world px (depth sort key). */
  bottom: number;
}

export interface ScreenRect extends Rect {
  kind: 'board' | 'tv' | 'taskboard';
  itemId: string;
  big: boolean;
}

export interface AreaCanvas {
  area: AreaLayout;
  key: string;
  /** World px of the canvas top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  ground: HTMLCanvasElement;
  furn: HTMLCanvasElement;
  /** Extra pixels above the area rect that the furniture canvas covers (corridor overhang). */
  furnMargin: number;
  items: PlacedItem[];
  /** Items that may stand in front of characters. */
  tall: PlacedItem[];
  panes: Rect[];
  screens: ScreenRect[];
}

/** Wall decorations that spell words in the viewer's language (the pantry menu); signs carry brand or project names. */
function hasLocalizedWallText(area: AreaLayout): boolean {
  return area.wallItems.some((item) => item.kind === 'menu');
}

/**
 * Cache key of an area's static layers. The locale only takes part for areas that paint translated text, so a language
 * change redraws just those and leaves the other canvases alone.
 */
export function areaKey(area: AreaLayout, extra = '', locale: Locale = 'pt-BR'): string {
  const furn = area.furniture.map((f) => `${f.kind}${f.x},${f.y},${f.variant}`).join(';');
  const lang = hasLocalizedWallText(area) ? locale : '';
  return `${area.id}|${area.rect.x},${area.rect.y},${area.rect.w}|${area.label}|${JSON.stringify(area.theme)}|${furn}|${area.doors.length}|${extra}|${lang}`;
}

function drawShadow(ctx: Ctx, item: FurnitureItem, ox: number, oy: number): void {
  if (item.kind === 'rug' || item.kind === 'railing') return;
  const x = (item.x - ox) * TILE;
  const y = (item.y - oy) * TILE;
  const w = item.w * TILE;
  const h = item.h * TILE;
  ctx.fillStyle = 'rgba(8,10,18,0.20)';
  if (item.kind === 'chair' || item.kind === 'meetChair' || item.kind === 'stool' || item.kind === 'cafeChair' || item.kind === 'bin') {
    ellipse(ctx, x + w / 2, y + h - 2, Math.max(4, w / 2 - 2), 3, 'rgba(8,10,18,0.22)');
    return;
  }
  if (item.kind === 'plant' || item.kind === 'plantTall' || item.kind === 'lamp' || item.kind === 'waterCooler') {
    ellipse(ctx, x + w / 2 + 1, y + h - 2, 7, 3, 'rgba(8,10,18,0.24)');
    return;
  }
  ctx.fillRect(x + 1, y + 3, w + 1, h - 1);
  ctx.fillStyle = 'rgba(8,10,18,0.10)';
  ctx.fillRect(x, y + h - 1, w + 3, 3);
}

function wallShade(ctx: Ctx, area: AreaLayout): void {
  const y = (area.floor.y - area.rect.y) * TILE;
  const w = area.rect.w * TILE;
  const grad = ctx.createLinearGradient(0, y, 0, y + 8);
  grad.addColorStop(0, 'rgba(10,12,20,0.30)');
  grad.addColorStop(1, 'rgba(10,12,20,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, y, w, 8);
}

function buildGround(area: AreaLayout, corridorTheme: AreaLayout['theme'], text: WorldText): { canvas: HTMLCanvasElement; panes: Rect[]; screens: ScreenRect[] } {
  const w = area.rect.w * TILE;
  const h = area.rect.h * TILE;
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  const ox = area.rect.x;
  const oy = area.rect.y;
  const isTerrace = area.kind === 'terrace';

  const floorRows = { from: area.floor.y, to: area.floor.y + area.floor.h };
  for (let ty = floorRows.from; ty <= floorRows.to; ty++) {
    for (let tx = area.rect.x; tx < area.rect.x + area.rect.w; tx++) {
      paintFloorTile(ctx, area.theme, tx, ty, (tx - ox) * TILE, (ty - oy) * TILE, area.id);
    }
  }
  for (const item of area.furniture) {
    if (item.kind === 'rug') {
      ctx.save();
      ctx.translate((item.x - ox) * TILE, (item.y - oy) * TILE);
      rugFill(ctx, item, area.theme.accent, area.theme.carpet);
      ctx.restore();
    }
  }
  wallShade(ctx, area);

  const panes = paintWall(ctx, area);
  const screens: ScreenRect[] = [];
  for (const wi of area.wallItems) {
    if (wi.side !== 'north') continue;
    const frame: WallItemFrame = paintWallItem(ctx, wi, wi.x - ox, area.label, area.theme.accent, text);
    if (frame.screen) screens.push({ ...frame.screen, kind: wi.kind === 'board' ? 'board' : wi.kind === 'whiteboard' ? 'taskboard' : 'tv', itemId: wi.id, big: wi.w >= 6 });
  }
  if (!isTerrace) paintSideWall(ctx, area);
  paintLedge(ctx, area);
  paintDoors(ctx, area, corridorTheme);
  return { canvas, panes: panes.map((p) => ({ ...p })), screens: screens.map((s) => ({ ...s, x: s.x + ox * TILE, y: s.y + oy * TILE })) };
}

function sortItems(items: PlacedItem[]): PlacedItem[] {
  return [...items].sort((a, b) => a.bottom - b.bottom || a.x - b.x);
}

function placeItems(area: AreaLayout): PlacedItem[] {
  const placed: PlacedItem[] = [];
  for (const item of area.furniture) {
    if (item.kind === 'rug') continue;
    const sprite = furnitureSprite(item);
    if (!sprite) continue;
    placed.push({
      item,
      sprite: sprite.canvas,
      x: item.x * TILE,
      y: item.y * TILE - spriteRise(item.kind),
      bottom: (item.y + item.h) * TILE,
    });
  }
  return sortItems(placed);
}

/** Pre-render an area into a ground canvas (floor, walls, decoration) and a furniture canvas. */
export function buildAreaCanvas(area: AreaLayout, key: string, corridorTheme: AreaLayout['theme'], furnMargin = 0, text: WorldText = worldText('pt-BR')): AreaCanvas {
  const { canvas: ground, panes, screens } = buildGround(area, corridorTheme, text);
  const items = placeItems(area);
  const x = area.rect.x * TILE;
  const y = area.rect.y * TILE;
  const furn = makeCanvas(ground.width, ground.height + furnMargin);
  const fctx = context2d(furn);
  fctx.save();
  fctx.translate(0, furnMargin);
  for (const item of area.furniture) drawShadow(fctx, item, area.rect.x, area.rect.y);
  fctx.restore();
  for (const p of items) fctx.drawImage(p.sprite, p.x - x, p.y - y + furnMargin);
  return {
    area, key, x, y, w: ground.width, h: ground.height, ground, furn, furnMargin, items,
    tall: items.filter((p) => p.item.tall), panes, screens,
  };
}

export const WALL_PIXELS = WALL_ROWS * TILE;

const CORRIDOR_OVERHANG = 22;

function facade(ctx: Ctx, x: number, h: number, east: boolean): void {
  ctx.fillStyle = '#2b2f38';
  ctx.fillRect(x, 0, TILE, h);
  const gx = east ? x : x + 6;
  ctx.fillStyle = 'rgba(165,208,226,0.55)';
  ctx.fillRect(gx, 2, 10, h - 4);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(gx + 2, 3, 1, h - 6);
  ctx.fillStyle = '#b8923f';
  ctx.fillRect(gx - (east ? 0 : 1), 0, 11, 2);
  ctx.fillRect(gx - (east ? 0 : 1), h - 2, 11, 2);
  ctx.fillRect(gx + 4, 2, 2, h - 4);
  ctx.fillStyle = '#7d5f22';
  ctx.fillRect(east ? x : x + 15, 0, 1, h);
  // handles of the double door
  ctx.fillStyle = '#f2dc96';
  ctx.fillRect(gx + 3, Math.floor(h / 2) - 3, 1, 6);
  ctx.fillRect(gx + 6, Math.floor(h / 2) - 3, 1, 6);
}

/** The corridor (and its two glass façades) as one strip spanning the whole building width. */
export function buildCorridorCanvas(corridor: AreaLayout, buildingWidth: number, key: string): AreaCanvas {
  const h = corridor.rect.h * TILE;
  const w = buildingWidth * TILE;
  const ground = makeCanvas(w, h);
  const ctx = context2d(ground);
  const ox = 0;
  const oy = corridor.rect.y;
  for (let ty = corridor.rect.y; ty < corridor.rect.y + corridor.rect.h; ty++) {
    for (let tx = 0; tx < buildingWidth; tx++) paintFloorTile(ctx, corridor.theme, tx, ty, tx * TILE, (ty - oy) * TILE, 'corridor');
  }
  for (const item of corridor.furniture) {
    if (item.kind !== 'rug') continue;
    ctx.save();
    ctx.translate((item.x - ox) * TILE, (item.y - oy) * TILE);
    ctx.fillStyle = item.variant ? '#7f93a6' : '#a8957c';
    ctx.fillRect(1, 3, item.w * TILE - 2, 10);
    ctx.fillStyle = '#b8923f';
    ctx.fillRect(1, 3, item.w * TILE - 2, 1);
    ctx.fillRect(1, 12, item.w * TILE - 2, 1);
    ctx.fillStyle = item.variant ? '#8fa3b6' : '#b8a68c';
    for (let x = 6; x < item.w * TILE - 6; x += 12) ctx.fillRect(x, 6, 6, 4);
    ctx.restore();
  }
  // soft shadow under the north ledge and the south wall top
  const top = ctx.createLinearGradient(0, 0, 0, 7);
  top.addColorStop(0, 'rgba(10,12,20,0.28)');
  top.addColorStop(1, 'rgba(10,12,20,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, 7);
  facade(ctx, 0, h, false);
  facade(ctx, (buildingWidth - 1) * TILE, h, true);

  const items = placeItems(corridor);
  const furn = makeCanvas(w, h + CORRIDOR_OVERHANG);
  const fctx = context2d(furn);
  const x = 0;
  const y = corridor.rect.y * TILE;
  fctx.save();
  fctx.translate(0, CORRIDOR_OVERHANG);
  for (const item of corridor.furniture) drawShadow(fctx, item, 0, corridor.rect.y);
  fctx.restore();
  for (const p of items) fctx.drawImage(p.sprite, p.x - x, p.y - y + CORRIDOR_OVERHANG);
  return {
    area: corridor, key, x, y, w, h, ground, furn, furnMargin: CORRIDOR_OVERHANG, items,
    tall: items.filter((p) => p.item.tall), panes: [], screens: [],
  };
}

/** East end wall of the building (one tile column, full height). */
export function buildEndCap(height: number): HTMLCanvasElement {
  const h = height * TILE;
  const canvas = makeCanvas(TILE, h);
  const ctx = context2d(canvas);
  ctx.fillStyle = '#272b33';
  ctx.fillRect(0, 0, 6, h);
  ctx.fillStyle = '#7b8392';
  ctx.fillRect(0, 0, 1, h);
  ctx.fillStyle = '#1b1e24';
  ctx.fillRect(5, 0, 1, h);
  ctx.fillStyle = 'rgba(8,10,18,0.28)';
  ctx.fillRect(6, 0, 5, h);
  return canvas;
}
