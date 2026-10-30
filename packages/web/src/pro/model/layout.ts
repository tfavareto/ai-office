// The canvas layout: one cluster per orchestrator (its terminal on top, the subagents in fixed rows under it), the
// clusters of a room side by side under the room's name, rooms packed in rows. Deterministic: the same input gives the
// same positions. A cluster always reserves the same width and only grows downward with the rows it has needed, and
// clusters are aligned at the top, so subagents coming and going move nothing that is already there.
import { rectBottom, rectRight, translateRect, unionRects, type Point, type Rect } from './geometry';
import { clusterFootprint, orchestratorRect, slotRect } from './slots';

/** Space around the clusters of a room (there is no box: it only separates), and the line with the room's name. */
export const FRAME_PADDING = 0;
export const FRAME_HEADER = 96;
/** Free space between the clusters of a room, and between rooms. */
export const CLUSTER_GAP = 120;
export const FRAME_GAP = 280;
/** Rooms are packed left to right until a row would pass this width, then a new row starts. */
export const ROW_MAX_WIDTH = 4800;

export interface LayoutCluster {
  /** The orchestrator's agent id. */
  id: string;
  /** Most rows of subagents the cluster has needed so far (0 = no subagent yet): what it reserves. */
  rows: number;
  /** Subagent id → slot. */
  slots: Readonly<Record<string, number>>;
}

export interface LayoutRoom {
  id: string;
  clusters: readonly LayoutCluster[];
}

/** A user's drag, relative to where the layout puts the thing. */
export type Offsets = Readonly<Record<string, Point>>;

export interface ClusterPlacement {
  id: string;
  roomId: string;
  /** Center of the orchestrator terminal. */
  center: Point;
  footprint: Rect;
}

export interface FramePlacement {
  roomId: string;
  /** What the room takes, its name line included. */
  rect: Rect;
}

export interface Layout {
  frames: readonly FramePlacement[];
  clusters: readonly ClusterPlacement[];
  /** Terminal rectangles by agent id (orchestrators and subagents). */
  nodes: ReadonlyMap<string, Rect>;
  /** Everything, for "fit all". Null when empty. */
  bounds: Rect | null;
}

export interface LayoutOffsets {
  /** Moves a whole cluster (orchestrator and subagents), by the orchestrator's id. */
  clusters?: Offsets;
  /** Moves one terminal on top of its cluster's offset, by agent id. */
  panels?: Offsets;
}

interface Row {
  width: number;
  height: number;
  /** Footprint of each cluster (around (0, 0)) and where its top-left goes, relative to the room's content origin. */
  cells: { cluster: LayoutCluster; footprint: Rect; origin: Point }[];
}

/** The clusters of a room side by side, aligned at the top (a taller one grows downward only). */
function packClusters(clusters: readonly LayoutCluster[]): Row {
  let x = 0;
  const cells = clusters.map((cluster) => {
    const footprint = clusterFootprint({ x: 0, y: 0 }, cluster.rows);
    const cell = { cluster, footprint, origin: { x, y: 0 } };
    x += footprint.width + CLUSTER_GAP;
    return cell;
  });
  const width = Math.max(0, x - CLUSTER_GAP);
  const height = cells.reduce((max, cell) => Math.max(max, cell.footprint.height), 0);
  return { width, height, cells };
}

interface RoomBlock {
  room: LayoutRoom;
  grid: Row;
  width: number;
  height: number;
}

function blockOf(room: LayoutRoom): RoomBlock {
  const grid = packClusters(room.clusters);
  return { room, grid, width: grid.width + 2 * FRAME_PADDING, height: grid.height + 2 * FRAME_PADDING + FRAME_HEADER };
}

/** Computes where everything goes. Rooms without clusters take no space. */
export function computeLayout(rooms: readonly LayoutRoom[], offsets: LayoutOffsets = {}): Layout {
  const blocks = rooms.filter((room) => room.clusters.length > 0).map(blockOf);
  const frames: FramePlacement[] = [];
  const clusters: ClusterPlacement[] = [];
  const nodes = new Map<string, Rect>();

  let rowX = 0;
  let rowY = 0;
  let rowHeight = 0;
  for (const block of blocks) {
    if (rowX > 0 && rowX + block.width > ROW_MAX_WIDTH) {
      rowX = 0;
      rowY += rowHeight + FRAME_GAP;
      rowHeight = 0;
    }
    const frameRect: Rect = { x: rowX, y: rowY, width: block.width, height: block.height };
    const content: Point = { x: rowX + FRAME_PADDING, y: rowY + FRAME_PADDING + FRAME_HEADER };
    const members: Rect[] = [frameRect];
    for (const cell of block.grid.cells) {
      const shift = offsets.clusters?.[cell.cluster.id] ?? { x: 0, y: 0 };
      // The footprint was computed around (0, 0): its top-left tells how far the orchestrator's center is from it.
      const center = {
        x: content.x + cell.origin.x + shift.x - cell.footprint.x,
        y: content.y + cell.origin.y + shift.y - cell.footprint.y,
      };
      const footprint = translateRect(cell.footprint, center.x, center.y);
      clusters.push({ id: cell.cluster.id, roomId: block.room.id, center, footprint });
      members.push(
        footprint,
        placeNode(nodes, cell.cluster.id, orchestratorRect(center), offsets.panels),
        ...Object.entries(cell.cluster.slots).map(([subId, slot]) =>
          placeNode(nodes, subId, slotRect(center, slot), offsets.panels),
        ),
      );
    }
    // A dragged terminal or cluster can leave the frame: the frame grows to hold it.
    const grown = unionRects(members) as Rect;
    frames.push({ roomId: block.room.id, rect: grown });
    rowX += block.width + FRAME_GAP;
    rowHeight = Math.max(rowHeight, block.height);
  }
  const bounds = unionRects(frames.map((frame) => frame.rect));
  return { frames, clusters, nodes, bounds };
}

function placeNode(nodes: Map<string, Rect>, id: string, rect: Rect, panels: Offsets | undefined): Rect {
  const shift = panels?.[id];
  const placed = shift === undefined ? rect : translateRect(rect, shift.x, shift.y);
  nodes.set(id, placed);
  return placed;
}

/** Whether `outer` contains `inner` entirely. */
export function holds(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    rectRight(inner) <= rectRight(outer) &&
    rectBottom(inner) <= rectBottom(outer)
  );
}
