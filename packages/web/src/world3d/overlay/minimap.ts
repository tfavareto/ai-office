// First-person minimap: the floor plan with room outlines, people and the player's heading.
import type { BuildingLayout } from '../../layout/types';
import type { Character } from '../../sim/types';
import { TILE_M } from '../units';

const MAP_W = 230;

export interface MinimapState {
  building: BuildingLayout;
  characters: readonly Character[];
  player: { x: number; z: number; yaw: number };
  accent: (character: Character) => string;
}

export function paintMinimap(ctx: CanvasRenderingContext2D, _w: number, h: number, s: MinimapState): void {
  const b = s.building;
  const scale = MAP_W / b.width;
  const mapH = b.height * scale;
  const ox = 16;
  const oy = h - mapH - 16;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = 'rgba(12,17,28,0.78)';
  ctx.fillRect(-6, -6, MAP_W + 12, mapH + 12);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++)
      if (b.grid.walkable[y * b.width + x]) ctx.fillRect(x * scale, y * scale, scale + 0.4, scale + 0.4);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (const a of b.areas) ctx.strokeRect(a.rect.x * scale, a.rect.y * scale, a.rect.w * scale, a.rect.h * scale);
  for (const c of s.characters) {
    if (c.alpha < 0.5) continue;
    ctx.fillStyle = s.accent(c);
    ctx.beginPath();
    ctx.arc(c.x * scale, c.y * scale, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const px = (s.player.x / TILE_M) * scale;
  const pz = (s.player.z / TILE_M) * scale;
  ctx.translate(px, pz);
  ctx.rotate(-s.player.yaw);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(4, -4);
  ctx.lineTo(0, -2);
  ctx.lineTo(-4, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
