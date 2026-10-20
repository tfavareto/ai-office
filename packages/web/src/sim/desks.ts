// Finding the empty desk under a point of the floor plan (clicking it hires an agent for that room).
import type { BuildingLayout, Rect } from '../layout/types';
import type { RoomManager } from './rooms';
import type { SpotBook } from './spots';

/** Tiles above a desk that belong to it (the monitors stand there) and below it (the chair). */
const ABOVE_TILES = 1;
const BELOW_TILES = 1;

export interface DeskTarget {
  projectId: string;
  areaId: string;
  /** Index of the desk inside its room (0-5). */
  deskIndex: number;
  /** Footprint of the desk table in tiles. */
  rect: Rect;
}

/** The unclaimed desk whose table, monitors or chair cover the tile position (tx, ty), in a room that is fully built. */
export function emptyDeskAt(building: BuildingLayout, spots: SpotBook, rooms: RoomManager, tx: number, ty: number): DeskTarget | null {
  for (const area of building.areas) {
    if (area.kind !== 'project' || area.projectId === undefined) continue;
    const room = rooms.byArea(area.id);
    if (room === undefined || room.ghost || room.phase !== 'open') continue;
    for (const desk of area.furniture) {
      if (desk.kind !== 'desk') continue;
      if (tx < desk.x || tx >= desk.x + desk.w || ty < desk.y - ABOVE_TILES || ty >= desk.y + desk.h + BELOW_TILES) continue;
      const seat = area.spots.find((spot) => spot.kind === 'desk' && spot.deskIndex === desk.variant);
      if (seat === undefined || !spots.isFree(seat.id)) continue;
      return { projectId: area.projectId, areaId: area.id, deskIndex: desk.variant, rect: { x: desk.x, y: desk.y, w: desk.w, h: desk.h } };
    }
  }
  return null;
}
