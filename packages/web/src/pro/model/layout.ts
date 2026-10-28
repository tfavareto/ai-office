// The canvas layout: one cluster per orchestrator (its terminal in the middle, the subagents in fixed slots around it),
// clusters grouped in a frame per room, frames packed in rows. Deterministic: the same input gives the same positions,
// and a cluster's footprint depends only on the ring it has grown to, so subagents coming and going move nothing.
import { rectBottom, rectRight, translateRect, unionRects, type Point, type Rect } from './geometry';
import { clusterFootprint, orchestratorRect, slotRect } from './slots';

/** Space around the clusters inside a room frame, and the strip with the room's name above them. */
export const FRAME_PADDING = 44;
export const FRAME_HEADER = 72;
/** Free space between the cluster footprints of a frame, and between frames. */
export const CLUSTER_GAP = 72;
export const FRAME_GAP = 160;
/** Frames are packed left to right until a row would pass this width, then a new row starts. */
export const ROW_MAX_WIDTH = 4800;

export interface LayoutCluster {
  /** The orchestrator's agent id. */
  id: string;
  /** Biggest ring the cluster has needed so far (0 = no subagent yet): what it reserves. */
  ring: number;
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
  /** The frame, header included. */
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

function columnsFor(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

interface Grid {
  width: number;
  height: number;
  /** Footprint size of each cluster and where its top-left goes, relative to the frame's content origin. */
  cells: { cluster: LayoutCluster; footprint: Rect; origin: Point }[];
}

function packClusters(clusters: readonly LayoutCluster[]): Grid {
  const columns = columnsFor(clusters.length);
  const footprints = clusters.map((cluster) => clusterFootprint({ x: 0, y: 0 }, cluster.ring));
  const columnWidths: number[] = [];
  const rowHeights: number[] = [];
  footprints.forEach((footprint, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, footprint.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, footprint.height);
  });
  const columnX = columnWidths.map((_, column) =>
    columnWidths.slice(0, column).reduce((sum, width) => sum + width + CLUSTER_GAP, 0),
  );
  const rowY = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((sum, height) => sum + height + CLUSTER_GAP, 0),
  );
  const cells = clusters.map((cluster, index) => {
    const footprint = footprints[index] as Rect;
    const column = index % columns;
    const row = Math.floor(index / columns);
    // Centered in its cell, so a smaller cluster does not hug the corner.
    const origin = {
      x: (columnX[column] ?? 0) + ((columnWidths[column] ?? 0) - footprint.width) / 2,
      y: (rowY[row] ?? 0) + ((rowHeights[row] ?? 0) - footprint.height) / 2,
    };
    return { cluster, footprint, origin };
  });
  const width = columnWidths.reduce((sum, w) => sum + w, 0) + CLUSTER_GAP * Math.max(0, columnWidths.length - 1);
  const height = rowHeights.reduce((sum, h) => sum + h, 0) + CLUSTER_GAP * Math.max(0, rowHeights.length - 1);
  return { width, height, cells };
}

interface RoomBlock {
  room: LayoutRoom;
  grid: Grid;
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
