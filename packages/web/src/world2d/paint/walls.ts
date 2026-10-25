import type { AreaLayout, Rect } from '../../layout/types';
import { mix, noise2, rgba, shade } from '../color';
import { BRASS, GRAPHITE, MARBLE, WALNUT, WOODS } from '../palette';
import { type Ctx, hline, rect, vline } from './ctx';
import { paintFloorTile } from './floors';

const T = 16;
export const WALL_H = 32;
const CROWN_H = 3;
const SKIRT_Y = 28;
const PANE_Y = 4;
const PANE_H = 6;

function slats(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  wood: { dark: string; base: string; mid: string; light: string; hi: string },
  seed: number,
): void {
  rect(ctx, x, y, w, h, wood.dark);
  for (let sx = 0; sx < w; sx += 3) {
    const tone = noise2(Math.floor((x + sx) / 3), seed, 3);
    const c = tone < 0.34 ? wood.base : tone < 0.67 ? wood.mid : mix(wood.base, wood.light, 0.5);
    rect(ctx, x + sx, y, 2, h, c);
    vline(ctx, x + sx, y, h, mix(c, wood.hi, 0.35));
    if (noise2(sx + x, y, 8) > 0.8) rect(ctx, x + sx, y + Math.floor(noise2(sx, x, 9) * h), 1, 2, wood.dark);
  }
}

function bodyReception(ctx: Ctx, w: number): void {
  rect(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, '#cdc1aa');
  for (let x = 0; x < w; x += 48) {
    rect(ctx, x + 2, CROWN_H + 2, 44, 16, '#dcd1bd');
    hline(ctx, x + 2, CROWN_H + 2, 44, '#ebe2d1');
    vline(ctx, x, CROWN_H, SKIRT_Y - CROWN_H, BRASS.base);
  }
  rect(ctx, 0, 19, w, SKIRT_Y - 19, MARBLE.base);
  hline(ctx, 0, 19, w, BRASS.base);
  hline(ctx, 0, 20, w, BRASS.hi);
  for (let x = 0; x < w; x += 16) vline(ctx, x, 21, 7, MARBLE.shade);
}

function bodyCopa(ctx: Ctx, w: number): void {
  rect(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, '#b9d0c2');
  hline(ctx, 0, CROWN_H, w, '#cfe2d6');
  rect(ctx, 0, 17, w, SKIRT_Y - 17, '#f1f3f0');
  for (let row = 0; row < 3; row++) {
    const y = 17 + row * 4;
    hline(ctx, 0, y + 3, w, '#cdd7d1');
    for (let x = (row % 2) * 4; x < w; x += 8) vline(ctx, x, y, 4, '#cdd7d1');
  }
  hline(ctx, 0, 16, w, BRASS.base);
}

function bodyMeeting(ctx: Ctx, w: number): void {
  slats(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, WALNUT, 41);
  hline(ctx, 0, 18, w, BRASS.base);
  hline(ctx, 0, 19, w, rgba('#000000', 0.25));
}

function bodyBath(ctx: Ctx, w: number): void {
  rect(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, '#86bcc2');
  for (let y = CROWN_H; y < SKIRT_Y; y += 4) {
    hline(ctx, 0, y, w, '#a4d0d5');
    for (let x = (Math.floor(y / 4) % 2) * 2; x < w; x += 4) vline(ctx, x, y, 4, '#6ea5ac');
  }
  rect(ctx, 0, 19, w, 9, '#f0f6f6');
  hline(ctx, 0, 19, w, BRASS.base);
  for (let x = 0; x < w; x += 4) vline(ctx, x, 20, 8, '#d3e1e2');
}

function bodyLounge(ctx: Ctx, w: number): void {
  rect(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, '#264a53');
  hline(ctx, 0, CROWN_H, w, '#35616b');
  for (let x = 16; x < w; x += 64) {
    slats(ctx, x, CROWN_H, 32, SKIRT_Y - CROWN_H, WOODS[1], x);
  }
  hline(ctx, 0, 18, w, rgba('#000000', 0.2));
}

function plasterWall(ctx: Ctx, w: number, accent: string): void {
  const base = mix('#ece6da', accent, 0.2);
  rect(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, base);
  rect(ctx, 0, CROWN_H + 6, w, SKIRT_Y - CROWN_H - 6, shade(base, -0.03));
  hline(ctx, 0, 19, w, shade(base, -0.14));
  hline(ctx, 0, 20, w, shade(base, 0.12));
  for (let x = 0; x < w; x += 3)
    if (noise2(x, 4, 17) > 0.8) rect(ctx, x, CROWN_H + 6 + Math.floor(noise2(x, 9, 3) * 16), 1, 1, shade(base, -0.07));
}

function brickWall(ctx: Ctx, w: number, accent: string): void {
  const mortar = '#cfc3b3';
  rect(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, mortar);
  for (let row = 0; row * 4 < SKIRT_Y - CROWN_H; row++) {
    const y = CROWN_H + row * 4;
    const offset = row % 2 === 0 ? 0 : 4;
    for (let x = -offset; x < w; x += 8) {
      const tone = noise2(Math.floor((x + offset) / 8), row, 33);
      const brick = mix('#a45a45', accent, 0.18);
      const c = tone < 0.33 ? brick : tone < 0.66 ? shade(brick, -0.1) : shade(brick, 0.1);
      rect(ctx, Math.max(0, x), y, Math.min(7, w - Math.max(0, x)), 3, c);
      hline(ctx, Math.max(0, x), y, Math.min(7, w - Math.max(0, x)), shade(c, 0.18));
    }
  }
}

function concreteWall(ctx: Ctx, w: number, accent: string): void {
  const base = mix('#a4a8ad', accent, 0.08);
  rect(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, base);
  for (let x = 0; x < w; x += 32) {
    vline(ctx, x, CROWN_H, SKIRT_Y - CROWN_H, shade(base, -0.18));
    vline(ctx, x + 1, CROWN_H, SKIRT_Y - CROWN_H, shade(base, 0.1));
  }
  for (let x = 0; x < w; x++)
    for (let y = CROWN_H; y < SKIRT_Y; y += 2) {
      const n = noise2(x, y, 51);
      if (n > 0.88) rect(ctx, x, y, 1, 1, shade(base, 0.1));
      else if (n < 0.1) rect(ctx, x, y, 1, 1, shade(base, -0.1));
    }
}

function bodyProject(ctx: Ctx, area: AreaLayout, w: number): void {
  const accent = area.theme.accent;
  switch (area.theme.wall) {
    case 'plaster':
      plasterWall(ctx, w, accent);
      break;
    case 'brick':
      brickWall(ctx, w, accent);
      break;
    case 'concrete':
      concreteWall(ctx, w, accent);
      break;
    default:
      slats(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, WOODS[area.theme.wood], area.theme.hue);
  }
  rect(ctx, 0, CROWN_H, w, 2, accent);
  hline(ctx, 0, CROWN_H + 2, w, rgba(accent, 0.45));
  hline(ctx, 0, CROWN_H + 3, w, rgba(accent, 0.2));
  hline(ctx, 0, CROWN_H, w, shade(accent, 0.45));
}

function bodyTerrace(ctx: Ctx, w: number): void {
  rect(ctx, 0, CROWN_H, w, SKIRT_Y - CROWN_H, '#aeb6bd');
  rect(ctx, 0, CROWN_H, w, 12, 'rgba(190,225,240,0.55)');
  for (let x = 0; x < w; x += 16) vline(ctx, x, CROWN_H, SKIRT_Y - CROWN_H, GRAPHITE.light);
  rect(ctx, 0, 15, w, 13, '#c9c3b6');
  hline(ctx, 0, 15, w, '#e4dfd2');
}

/** Paint the north-wall face (2 tiles tall). Returns the clerestory pane rects in canvas pixels. */
export function paintWall(ctx: Ctx, area: AreaLayout): Rect[] {
  const w = area.rect.w * T;
  switch (area.kind) {
    case 'reception':
      bodyReception(ctx, w);
      break;
    case 'copa':
      bodyCopa(ctx, w);
      break;
    case 'meeting':
      bodyMeeting(ctx, w);
      break;
    case 'bathrooms':
      bodyBath(ctx, w);
      break;
    case 'lounge':
      bodyLounge(ctx, w);
      break;
    case 'terrace':
      bodyTerrace(ctx, w);
      break;
    default:
      bodyProject(ctx, area, w);
  }
  // crown moulding
  rect(ctx, 0, 0, w, CROWN_H, GRAPHITE.dark);
  hline(ctx, 0, 0, w, GRAPHITE.light);
  hline(ctx, 0, 2, w, GRAPHITE.deep);
  // skirting
  rect(ctx, 0, SKIRT_Y, w, 4, WALNUT.dark);
  hline(ctx, 0, SKIRT_Y, w, WALNUT.mid);
  hline(ctx, 0, WALL_H - 1, w, rgba('#000000', 0.45));
  return paintClerestory(ctx, area, w);
}

function paintClerestory(ctx: Ctx, area: AreaLayout, w: number): Rect[] {
  if (area.row !== 'north' || area.kind === 'terrace') return [];
  const panes: Rect[] = [];
  const ox = area.rect.x * T;
  const oy = area.rect.y * T;
  const x0 = 12;
  const x1 = w - 2;
  rect(ctx, x0 - 2, PANE_Y - 1, x1 - x0 + 4, PANE_H + 3, GRAPHITE.base);
  hline(ctx, x0 - 2, PANE_Y - 1, x1 - x0 + 4, GRAPHITE.light);
  const count = Math.max(1, Math.round((x1 - x0) / 28));
  const pw = Math.floor((x1 - x0 - (count - 1) * 2) / count);
  for (let i = 0; i < count; i++) {
    const px = x0 + i * (pw + 2);
    ctx.clearRect(px, PANE_Y, pw, PANE_H);
    panes.push({ x: ox + px, y: oy + PANE_Y, w: pw, h: PANE_H });
  }
  rect(ctx, x0 - 2, PANE_Y + PANE_H, x1 - x0 + 4, 2, MARBLE.shade);
  hline(ctx, x0 - 2, PANE_Y + PANE_H, x1 - x0 + 4, MARBLE.light);
  return panes;
}

/** Thin top cap + shadow of the west wall column, drawn over the floor rows. */
export function paintSideWall(ctx: Ctx, area: AreaLayout): void {
  const y = (area.floor.y - area.rect.y) * T;
  const h = area.floor.h * T;
  rect(ctx, 0, y, 5, h, GRAPHITE.dark);
  vline(ctx, 0, y, h, GRAPHITE.light);
  vline(ctx, 4, y, h, GRAPHITE.deep);
  rect(ctx, 5, y, 3, h, rgba('#000000', 0.22));
  rect(ctx, 8, y, 3, h, rgba('#000000', 0.09));
  for (const item of area.wallItems) {
    if (item.kind !== 'glassDoor' || item.side !== 'west') continue;
    const gy = (item.x - area.rect.y) * T;
    const gh = item.w * T;
    rect(ctx, 0, gy - 2, 6, gh + 4, BRASS.dark);
    rect(ctx, 1, gy, 4, gh, 'rgba(160,205,225,0.8)');
    vline(ctx, 2, gy, gh, 'rgba(255,255,255,0.6)');
    hline(ctx, 0, gy + Math.floor(gh / 2), 6, BRASS.hi);
  }
}

/** The low south ledge (cut-away wall) of a room. */
export function paintLedge(ctx: Ctx, area: AreaLayout): void {
  if (!area.ledge) return;
  const y = (area.ledge.y - area.rect.y) * T;
  const w = area.rect.w * T;
  const glass = area.kind === 'meeting' || area.kind === 'reception';
  rect(ctx, 0, y + 3, w, 3, GRAPHITE.light);
  hline(ctx, 0, y + 3, w, GRAPHITE.hi);
  hline(ctx, 0, y + 5, w, GRAPHITE.mid);
  if (glass) {
    rect(ctx, 0, y + 6, w, 10, 'rgba(150,200,220,0.55)');
    rect(ctx, 0, y + 9, w, 4, 'rgba(238,246,250,0.85)');
    hline(ctx, 0, y + 9, w, '#ffffff');
    for (let x = 0; x < w; x += 32) vline(ctx, x, y + 6, 10, GRAPHITE.mid);
  } else {
    rect(ctx, 0, y + 6, w, 10, GRAPHITE.base);
    hline(ctx, 0, y + 6, w, GRAPHITE.mid);
    hline(ctx, 0, y + 15, w, GRAPHITE.deep);
  }
  rect(ctx, 0, y, w, 3, rgba('#000000', 0.12));
}

/** Door openings: cut through the ledge (north row) or the wall face (south row) and frame them. */
export function paintDoors(ctx: Ctx, area: AreaLayout, corridorFloor: AreaLayout['theme']): void {
  for (const door of area.doors) {
    const x = (door.rect.x - area.rect.x) * T;
    const y = (door.rect.y - area.rect.y) * T;
    const w = door.rect.w * T;
    const h = door.rect.h * T;
    ctx.clearRect(x, y, w, h);
    if (area.row === 'north') {
      for (let i = 0; i < door.rect.w; i++)
        paintFloorTile(ctx, corridorFloor, door.rect.x + i, door.rect.y, x + i * T, y, 'corridor');
      rect(ctx, x, y + 5, w, 1, BRASS.base);
      rect(ctx, x - 2, y + 3, 2, 13, BRASS.dark);
      rect(ctx, x + w, y + 3, 2, 13, BRASS.dark);
      rect(ctx, x - 2, y + 2, w + 4, 2, BRASS.base);
      if (door.kind === 'glass') {
        rect(ctx, x + 1, y + 6, 3, 9, 'rgba(180,220,235,0.6)');
        rect(ctx, x + w - 4, y + 6, 3, 9, 'rgba(180,220,235,0.6)');
      }
    } else {
      rect(ctx, x, y, w, h, '#2b2118');
      for (let j = 0; j < door.rect.h; j++) {
        for (let i = 0; i < door.rect.w; i++)
          paintFloorTile(ctx, corridorFloor, door.rect.x + i, door.rect.y + j, x + i * T, y + j * T, 'corridor');
      }
      rect(ctx, x, y, w, h, 'rgba(20,16,12,0.28)');
      rect(ctx, x - 2, y, 2, h, BRASS.dark);
      rect(ctx, x + w, y, 2, h, BRASS.dark);
      rect(ctx, x - 2, y, w + 4, 4, door.kind === 'archway' ? BRASS.base : WALNUT.light);
      hline(ctx, x - 2, y, w + 4, door.kind === 'archway' ? BRASS.hi : WALNUT.hi);
      hline(ctx, x, y + h - 1, w, BRASS.base);
      if (door.kind === 'glass') {
        rect(ctx, x + 1, y + 4, 3, h - 6, 'rgba(180,220,235,0.55)');
        rect(ctx, x + w - 4, y + 4, 3, h - 6, 'rgba(180,220,235,0.55)');
      }
    }
  }
}
