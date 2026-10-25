// The moving parts of the unlockable decoration (2D): the fish and bubbles of the aquarium, the cat, and the glow that
// the neon sign, the garland, the arcade machines and the aquarium cast at night.
import { TILE } from '../../layout/constants';
import { isDrawn } from '../../layout/decor';
import type { FurnitureItem, Rect, WallItem } from '../../layout/types';
import type { Evolution } from '../../world/evolution';
import type { PetPose } from '../../world/pet';
import { CAT_ANCHOR, catFrame } from '../chars/petSprite';
import type { AreaCanvas } from '../layers/areaLayer';
import { type Ctx, context2d, makeCanvas, pixel, rect } from '../paint/ctx';
import { AQUARIUM_WATER, bulbPositions, neonGlowRect } from '../paint/furnDecor';
import { intersects } from '../blit';

const FISH = [
  { color: '#ff8a3d', fin: '#d85a1a', speed: 0.55, lane: 3, phase: 0 },
  { color: '#ffd24a', fin: '#d9a21a', speed: 0.38, lane: 7, phase: 2.2 },
] as const;
const BUBBLES = 3;

function decorItems(ac: AreaCanvas, evolution: Evolution, kind: FurnitureItem['kind']): FurnitureItem[] {
  return ac.area.furniture.filter(
    (item) => item.kind === kind && item.decor !== undefined && isDrawn(item, evolution.decor),
  );
}

function wallDecor(ac: AreaCanvas, evolution: Evolution, kind: WallItem['kind']): WallItem[] {
  return ac.area.wallItems.filter(
    (item) => item.kind === kind && item.decor !== undefined && isDrawn(item, evolution.decor),
  );
}

/** Fish swimming in the aquarium and bubbles rising from the stone. `time` in seconds. */
export function drawAquariumLife(ctx: Ctx, ac: AreaCanvas, evolution: Evolution, time: number, still: boolean): void {
  for (const tank of decorItems(ac, evolution, 'aquarium')) {
    const ox = tank.x * TILE + AQUARIUM_WATER.x;
    const oy = tank.y * TILE + AQUARIUM_WATER.y;
    const span = AQUARIUM_WATER.w - 7;
    for (const fish of FISH) {
      const t = still ? fish.phase : time * fish.speed + fish.phase;
      const swim = (Math.sin(t) + 1) / 2;
      const facingRight = Math.cos(t) > 0;
      const x = ox + 1 + Math.round(swim * span);
      const y = oy + fish.lane + Math.round(Math.sin(t * 2.3) * 1);
      rect(ctx, x + 1, y, 4, 2, fish.color);
      rect(ctx, facingRight ? x : x + 5, y - 1, 1, 3, fish.fin);
      pixel(ctx, facingRight ? x + 4 : x + 1, y, '#101820');
    }
    if (still) continue;
    for (let i = 0; i < BUBBLES; i++) {
      const rise = (time * 4 + i * 5) % AQUARIUM_WATER.h;
      pixel(ctx, ox + 14 + i * 2 + (i % 2), oy + AQUARIUM_WATER.h - 4 - Math.floor(rise), 'rgba(235,250,255,0.85)');
    }
  }
}

export function drawPet(ctx: Ctx, pose: PetPose): void {
  const sprite = catFrame(pose.mode, pose.dir, pose.phase, pose.t);
  ctx.drawImage(sprite, Math.round(pose.x * TILE) - CAT_ANCHOR.x, Math.round(pose.y * TILE) - CAT_ANCHOR.y);
}

// --- night glow ------------------------------------------------------------------------------------------------------------

const glows = new Map<string, HTMLCanvasElement>();

function glow(color: string): HTMLCanvasElement {
  let canvas = glows.get(color);
  if (canvas === undefined) {
    const size = 64;
    canvas = makeCanvas(size, size);
    const ctx = context2d(canvas);
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `${color}ff`);
    grad.addColorStop(0.4, `${color}66`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    glows.set(color, canvas);
  }
  return canvas;
}

function pool(ctx: Ctx, color: string, cx: number, cy: number, radius: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.drawImage(glow(color), cx - radius, cy - radius, radius * 2, radius * 2);
}

/** Additive night light of the decoration; call with `lighter` composition active. `night` is 0..1. */
export function drawDecorGlow(
  ctx: Ctx,
  areas: readonly AreaCanvas[],
  evolution: Evolution,
  night: number,
  vis: Rect,
  time: number,
  still: boolean,
): void {
  for (const ac of areas) {
    if (!intersects(ac.x, ac.y, ac.w, ac.h, vis)) continue;
    for (const sign of wallDecor(ac, evolution, 'neon')) {
      const g = neonGlowRect(sign.x - ac.area.rect.x, sign);
      const flicker = still ? 1 : 0.88 + 0.12 * Math.sin(time * 7.3) * Math.sin(time * 2.1);
      const gold = evolution.decor.has('goldFinish');
      const cx = ac.x + g.x + g.w / 2;
      const cy = ac.y + g.y + g.h / 2;
      pool(ctx, gold ? '#ffd24a' : '#27e0e6', cx - 10, cy, 30, night * 0.5 * flicker);
      pool(ctx, gold ? '#fff0a8' : '#ff5fb2', cx + 12, cy + 3, 26, night * 0.4 * flicker);
    }
    for (const tank of decorItems(ac, evolution, 'aquarium'))
      pool(ctx, '#46b6d0', tank.x * TILE + tank.w * 8, tank.y * TILE - 2, 34, night * 0.45);
    for (const machine of decorItems(ac, evolution, 'arcade'))
      pool(ctx, machine.variant % 2 ? '#8f6bff' : '#ffb02e', machine.x * TILE + 8, machine.y * TILE, 22, night * 0.5);
    for (const cabinet of decorItems(ac, evolution, 'trophyCabinet'))
      pool(ctx, '#ffe6a8', cabinet.x * TILE + cabinet.w * 8, cabinet.y * TILE - 6, 26, night * 0.3);
    for (const garland of decorItems(ac, evolution, 'lights'))
      for (const bulb of bulbPositions(garland.w * TILE, garland.variant)) {
        const twinkle = still ? 1 : 0.75 + 0.25 * Math.sin(time * 2 + bulb.x * 0.37);
        pool(ctx, bulb.color, garland.x * TILE + bulb.x + 1, garland.y * TILE + bulb.y + 2, 9, night * 0.7 * twinkle);
      }
  }
}
