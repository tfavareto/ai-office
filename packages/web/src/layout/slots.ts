import { NORTH_PROJECT_X, ROOM_W, SOUTH_PROJECT_X } from './constants';
import type { RowSide, SlotPos } from './types';

const cache: SlotPos[] = [];
const ends = { north: NORTH_PROJECT_X, south: SOUTH_PROJECT_X };

/**
 * Project slots fill whichever row ends first (south starts right after the Lounge, north after the meeting room), so
 * both rows end almost aligned and the building grows east evenly.
 */
export function slotPosition(index: number): SlotPos {
  while (cache.length <= index) {
    const row: RowSide = ends.south <= ends.north ? 'south' : 'north';
    cache.push({ index: cache.length, row, x: ends[row] });
    ends[row] += ROOM_W;
  }
  return cache[index];
}

/** East edge (exclusive) of each row when the first `count` slots are used. */
export function rowEnds(count: number): { north: number; south: number } {
  let north = NORTH_PROJECT_X;
  let south = SOUTH_PROJECT_X;
  for (let i = 0; i < count; i++) {
    const slot = slotPosition(i);
    if (slot.row === 'north') north = slot.x + ROOM_W;
    else south = slot.x + ROOM_W;
  }
  return { north, south };
}
