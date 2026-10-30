// Where the subagent terminals sit under their orchestrator, like a tree: the orchestrator on top, its subagents in
// rows of three beneath it. Slots are fixed offsets from the orchestrator's center: a subagent keeps its slot while it
// lives, so terminals never jump when others come and go. A row fills its middle first, then the left, then the right,
// so a single subagent sits right under its orchestrator.
import { rectBottom, rectRight, type Point, type Rect, type Size } from './geometry';

export const ORCHESTRATOR_SIZE: Size = { width: 600, height: 400 };
export const SUB_SIZE: Size = { width: 300, height: 210 };
/** Subagents per row under an orchestrator. */
export const SUB_COLUMNS = 3;
/** Free space between the orchestrator and the first row: room for the connector. */
export const LINK_GAP = 96;
/** Free space between two rows of subagents (the connector to a lower row runs through it). */
export const ROW_GAP = 48;
/** Free space between two subagents of a row (the connectors to lower rows run down through it). */
export const COLUMN_GAP = 36;
/** Slots a cluster can grow to; a subagent past the last slot shares it, which no real session reaches. */
export const MAX_SLOTS = 78;
export const MAX_ROWS = Math.ceil(MAX_SLOTS / SUB_COLUMNS);

const PITCH_X = SUB_SIZE.width + COLUMN_GAP;
const PITCH_Y = SUB_SIZE.height + ROW_GAP;
/** Fill order of the columns of a row: the middle, the left, the right. */
const COLUMN_ORDER: readonly number[] = [1, 0, 2];
/** The width every cluster reserves, with or without subagents, so a first subagent never pushes its neighbors. */
export const CLUSTER_WIDTH = Math.max(
  ORCHESTRATOR_SIZE.width,
  SUB_COLUMNS * SUB_SIZE.width + (SUB_COLUMNS - 1) * COLUMN_GAP,
);

function clampSlot(slot: number): number {
  return Math.min(Math.max(Math.floor(slot), 0), MAX_SLOTS - 1);
}

/** The row (0 = right under the orchestrator) and the column (0 = left) of a slot. */
export function slotCell(slot: number): { row: number; column: number } {
  const clamped = clampSlot(slot);
  return { row: Math.floor(clamped / SUB_COLUMNS), column: COLUMN_ORDER[clamped % SUB_COLUMNS] ?? 0 };
}

/** How many rows a cluster needs to hold `slot`. */
export function rowsForSlot(slot: number): number {
  return slotCell(slot).row + 1;
}

/** Center offset of a slot from the orchestrator's center. */
export function slotOffset(slot: number): Point {
  const { row, column } = slotCell(slot);
  return {
    x: (column - (SUB_COLUMNS - 1) / 2) * PITCH_X,
    y: ORCHESTRATOR_SIZE.height / 2 + LINK_GAP + row * PITCH_Y + SUB_SIZE.height / 2,
  };
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

/** What a cluster reserves for `rows` rows of subagents (0 = the orchestrator alone), centered on `center`. */
export function clusterFootprint(center: Point, rows: number): Rect {
  const count = Math.min(Math.max(Math.floor(rows), 0), MAX_ROWS);
  const below = count === 0 ? 0 : LINK_GAP + count * SUB_SIZE.height + (count - 1) * ROW_GAP;
  return {
    x: center.x - CLUSTER_WIDTH / 2,
    y: center.y - ORCHESTRATOR_SIZE.height / 2,
    width: CLUSTER_WIDTH,
    height: ORCHESTRATOR_SIZE.height + below,
  };
}

/** Gap between two rectangles along the axis that separates them (for tests). */
export function separation(a: Rect, b: Rect): number {
  const dx = Math.max(a.x - rectRight(b), b.x - rectRight(a));
  const dy = Math.max(a.y - rectBottom(b), b.y - rectBottom(a));
  return Math.max(dx, dy);
}
