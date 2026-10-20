import { TILE } from '../layout/constants';
import type { BuildingLayout } from '../layout/types';
import type { RoomState } from '../sim/rooms';
import type { Character } from '../sim/types';
import { ANCHOR_X, ANCHOR_Y, SPRITE_H, SPRITE_W } from './chars/sprites';
import { WHITEBOARD } from './paint/wallitems';

/** Pixels from the character's feet y to the sprite anchor (feet are drawn slightly below the tile centre). */
export const FOOT_OFFSET = 4;

/** World-px rectangle covered by a character's visible body (generous for easy clicking). */
export function characterBox(c: Character): { x: number; y: number; w: number; h: number } {
  const footX = c.x * TILE;
  const footY = c.y * TILE + FOOT_OFFSET;
  return { x: footX - ANCHOR_X + 4, y: footY - ANCHOR_Y + 2, w: SPRITE_W - 8, h: SPRITE_H - 4 };
}

/** The character under a world point (the one drawn in front wins), or null. Placeholders of agents being hired cannot be picked. */
export function pickCharacter(characters: readonly Character[], wx: number, wy: number): Character | null {
  let best: Character | null = null;
  for (const c of characters) {
    if (c.alpha < 0.5 || c.hiring) continue;
    const b = characterBox(c);
    if (wx < b.x || wx > b.x + b.w || wy < b.y || wy > b.y + b.h) continue;
    if (!best || c.y > best.y) best = c;
  }
  return best;
}

/** Project id of the room under a world point, or null (core areas, corridor and outdoors have no selection). */
export function pickRoom(building: BuildingLayout, rooms: readonly RoomState[], wx: number, wy: number): string | null {
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  for (const area of building.areas) {
    if (area.kind !== 'project') continue;
    const r = area.rect;
    if (tx < r.x || tx >= r.x + r.w || ty < r.y || ty >= r.y + r.h) continue;
    const room = rooms.find((x) => x.areaId === area.id);
    if (room && !room.ghost) return room.projectId;
  }
  return null;
}

/** World-px rectangle of the meeting-room whiteboard (the task board), or null when the building has none. */
export function whiteboardRect(building: BuildingLayout): { x: number; y: number; w: number; h: number } | null {
  for (const area of building.areas) {
    const item = area.wallItems.find((wi) => wi.kind === 'whiteboard' && wi.side === 'north');
    if (item) return { x: item.x * TILE + 1, y: area.rect.y * TILE + WHITEBOARD.y, w: item.w * TILE - 2, h: WHITEBOARD.h };
  }
  return null;
}

/** Whether a world point is on the whiteboard. */
export function pickWhiteboard(building: BuildingLayout, wx: number, wy: number): boolean {
  const r = whiteboardRect(building);
  return r !== null && wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h;
}
