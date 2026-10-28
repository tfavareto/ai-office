// Where the subagent terminals sit around their orchestrator. Slots are fixed offsets from the orchestrator's center:
// a subagent keeps its slot while it lives, so terminals never jump when others come and go. Rings grow outward: the
// first has three slots on each side of the orchestrator, the second adds one above and one below it, and so on.
import { rectBottom, rectRight, unionRects, type Point, type Rect, type Size } from './geometry';

export const ORCHESTRATOR_SIZE: Size = { width: 600, height: 400 };
export const SUB_SIZE: Size = { width: 300, height: 210 };
/** Free space between the orchestrator and the first ring: room for the link and its label. */
const LINK_GAP = 120;
/** Free space between neighboring subagent terminals. */
const NEIGHBOR_GAP = 36;
const PITCH_X = SUB_SIZE.width + NEIGHBOR_GAP;
const PITCH_Y = SUB_SIZE.height + NEIGHBOR_GAP;
const FIRST_COLUMN_X = ORCHESTRATOR_SIZE.width / 2 + LINK_GAP + SUB_SIZE.width / 2;
const FIRST_ROW_Y = ORCHESTRATOR_SIZE.height / 2 + LINK_GAP + SUB_SIZE.height / 2;
/** Rings the layout can grow to; a subagent past the last slot shares it, which no real session reaches. */
export const MAX_RING = 6;

/**
 * Center offsets of a ring's slots, in fill order. Ring 1 is a column of three on each side of the orchestrator;
 * ring 2 adds one terminal above and one below it and a second column of three on each side; each next ring is a
 * taller column on each side, farther out.
 */
function ringOffsets(ring: number): Point[] {
  const columnX = FIRST_COLUMN_X + PITCH_X * Math.max(0, ring - 1);
  const half = ring <= 2 ? 1 : ring - 1;
  const slots: Point[] = [];
  for (let row = 0; row <= half; row++) {
    const rows = row === 0 ? [0] : [-row, row];
    for (const j of rows) slots.push({ x: columnX, y: j * PITCH_Y }, { x: -columnX, y: j * PITCH_Y });
  }
  // Closest to the orchestrator's middle first, then the top before the bottom, the right side before the left.
  slots.sort(
    (a, b) => Math.abs(a.y) - Math.abs(b.y) || Math.sign(a.y) - Math.sign(b.y) || Math.sign(b.x) - Math.sign(a.x),
  );
  if (ring === 2) slots.unshift({ x: 0, y: -FIRST_ROW_Y }, { x: 0, y: FIRST_ROW_Y });
  return slots;
}

const RING_OFFSETS: readonly (readonly Point[])[] = Array.from({ length: MAX_RING + 1 }, (_, ring) =>
  ring === 0 ? [] : ringOffsets(ring),
);
const ALL_OFFSETS: readonly Point[] = RING_OFFSETS.flat();
/** Index of the first slot of each ring (and the total at the end). */
const RING_STARTS: readonly number[] = RING_OFFSETS.reduce<number[]>(
  (starts, ring) => [...starts, (starts[starts.length - 1] ?? 0) + ring.length],
  [0],
);

/** How many slots rings 1..`ring` hold. */
export function slotCount(ring: number): number {
  return RING_STARTS[Math.min(Math.max(ring, 0), MAX_RING) + 1] ?? 0;
}

/** Ring a slot belongs to (1-based). */
export function ringOfSlot(slot: number): number {
  for (let ring = 1; ring <= MAX_RING; ring++) if (slot < slotCount(ring)) return ring;
  return MAX_RING;
}

/** Center offset of a slot from the orchestrator's center. Slots past the last ring repeat its last position. */
export function slotOffset(slot: number): Point {
  return ALL_OFFSETS[Math.min(Math.max(slot, 0), ALL_OFFSETS.length - 1)] ?? { x: 0, y: 0 };
}

/** The rectangle of a subagent terminal in a cluster whose orchestrator is centered on `center`. */
export function slotRect(center: Point, slot: number): Rect {
  const offset = slotOffset(slot);
  return {
    x: center.x + offset.x - SUB_SIZE.width / 2,
    y: center.y + offset.y - SUB_SIZE.height / 2,
    width: SUB_SIZE.width,
    height: SUB_SIZE.height,
  };
}

export function orchestratorRect(center: Point): Rect {
  return {
    x: center.x - ORCHESTRATOR_SIZE.width / 2,
    y: center.y - ORCHESTRATOR_SIZE.height / 2,
    width: ORCHESTRATOR_SIZE.width,
    height: ORCHESTRATOR_SIZE.height,
  };
}

/** What a cluster reserves in the layout for its rings up to `ring` (0 = the orchestrator alone), centered on `center`. */
export function clusterFootprint(center: Point, ring: number): Rect {
  const rects = [orchestratorRect(center)];
  for (let slot = 0; slot < slotCount(ring); slot++) rects.push(slotRect(center, slot));
  return unionRects(rects) as Rect;
}

/** Gap between a slot terminal and the orchestrator, along the axis that separates them (for tests and links). */
export function separation(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - rectRight(b), b.x - rectRight(a));
  const dy = Math.max(a.y - rectBottom(b), b.y - rectBottom(a));
  return Math.max(dx, dy);
}
