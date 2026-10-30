// The connectors from an orchestrator to its subagents: which state each one draws and its path. Pure.
import type { Agent } from '@ai-office/shared';
import { rectBottom, rectCenter, rectRight, type Point, type Rect } from './geometry';
import { COLUMN_GAP, LINK_GAP, ROW_GAP } from './slots';

/**
 * flowing: the subagent works (animated dashes) · waiting: it needs the user (amber) · done: finished (dim) ·
 * idle: alive but not working (thin and still).
 */
export type LinkState = 'flowing' | 'waiting' | 'done' | 'idle';

export function linkState(agent: Pick<Agent, 'status'>, finished: boolean): LinkState {
  if (finished) return 'done';
  switch (agent.status) {
    case 'working':
      return 'flowing';
    case 'waiting':
      return 'waiting';
    case 'done':
    case 'offline':
      return 'done';
    case 'idle':
      return 'idle';
  }
}

export interface LinkPath {
  /** SVG path data: straight segments at right angles, from the orchestrator's edge to the subagent's. */
  d: string;
  start: Point;
  end: Point;
}

/** Keeps the attachment point away from the corners of a terminal. */
const EDGE_MARGIN = 24;

function clampBetween(value: number, min: number, max: number): number {
  return max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value));
}

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * The connector of a subagent that sits below its orchestrator, drawn like an org chart: down from the orchestrator's
 * bottom, along the free strip just above the subagent, then down into the middle of its top edge. The vertical part
 * runs in the gap between two columns (half a column gap beside the subagent, on the orchestrator's side), so a line to
 * a lower row never crosses a terminal of the rows above. A subagent right under the orchestrator gets a straight drop.
 */
function treePath(from: Rect, to: Rect): LinkPath {
  const fromCenter = rectCenter(from).x;
  const childX = rectCenter(to).x;
  const gap = to.y - rectBottom(from);
  const firstRow = gap <= LINK_GAP + 1;
  const left = from.x + EDGE_MARGIN;
  const right = rectRight(from) - EDGE_MARGIN;
  if (firstRow && childX >= left && childX <= right) {
    const start = { x: childX, y: rectBottom(from) };
    const end = { x: childX, y: to.y };
    return { d: `M${round(start.x)} ${round(start.y)}V${round(end.y)}`, start, end };
  }
  const side = childX > fromCenter ? -1 : 1;
  const trunk = clampBetween(childX + side * (to.width / 2 + COLUMN_GAP / 2), left, right);
  const bus = to.y - (firstRow ? gap / 2 : ROW_GAP / 2);
  const start = { x: trunk, y: rectBottom(from) };
  const end = { x: childX, y: to.y };
  const d = `M${round(start.x)} ${round(start.y)}V${round(bus)}H${round(end.x)}V${round(end.y)}`;
  return { d, start, end };
}

/** The connector of a terminal dragged beside or above its orchestrator: out of the facing side, one elbow, in. */
function sidePath(from: Rect, to: Rect): LinkPath {
  const a = rectCenter(from);
  const b = rectCenter(to);
  const toRight = b.x >= a.x;
  const start = {
    x: toRight ? rectRight(from) : from.x,
    y: clampBetween(b.y, from.y + EDGE_MARGIN, rectBottom(from) - EDGE_MARGIN),
  };
  const end = {
    x: toRight ? to.x : rectRight(to),
    y: clampBetween(start.y, to.y + EDGE_MARGIN, rectBottom(to) - EDGE_MARGIN),
  };
  const middle = (start.x + end.x) / 2;
  const d = `M${round(start.x)} ${round(start.y)}H${round(middle)}V${round(end.y)}H${round(end.x)}`;
  return { d, start, end };
}

/** The connector between an orchestrator and one of its subagents. */
export function linkPath(from: Rect, to: Rect): LinkPath {
  const below = to.y >= rectBottom(from);
  const overlapsSideways = to.x < rectRight(from) + LINK_GAP && rectRight(to) > from.x - LINK_GAP;
  return below && overlapsSideways ? treePath(from, to) : sidePath(from, to);
}
