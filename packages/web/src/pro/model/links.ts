// The lines from an orchestrator to its subagents: which state each one draws, its curve and its label. Pure.
import type { Agent } from '@ai-office/shared';
import { agentRole, agentTitle } from '../../ui/display';
import { rectBottom, rectCenter, rectRight, type Point, type Rect } from './geometry';

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
  /** SVG path data (a cubic curve) from the orchestrator's edge to the subagent's edge. */
  d: string;
  /** Where the label goes (the middle of the curve). */
  mid: Point;
  start: Point;
  end: Point;
}

/** Keeps the attachment point away from the corners of a terminal. */
const EDGE_MARGIN = 36;
const CURVE_PULL = 0.45;

function clampBetween(value: number, min: number, max: number): number {
  return max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value));
}

/**
 * The curve between two terminals. It leaves the orchestrator on the side that faces the subagent and arrives on
 * the side that faces the orchestrator, so lines never cross a terminal.
 */
export function linkPath(from: Rect, to: Rect): LinkPath {
  const a = rectCenter(from);
  const b = rectCenter(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) / (from.width / 2 + to.width / 2) >= Math.abs(dy) / (from.height / 2 + to.height / 2);
  let start: Point;
  let end: Point;
  let c1: Point;
  let c2: Point;
  if (horizontal) {
    const sign = dx >= 0 ? 1 : -1;
    start = {
      x: sign > 0 ? rectRight(from) : from.x,
      y: clampBetween(b.y, from.y + EDGE_MARGIN, rectBottom(from) - EDGE_MARGIN),
    };
    end = {
      x: sign > 0 ? to.x : rectRight(to),
      y: clampBetween(start.y, to.y + EDGE_MARGIN, rectBottom(to) - EDGE_MARGIN),
    };
    const pull = Math.abs(end.x - start.x) * CURVE_PULL * sign;
    c1 = { x: start.x + pull, y: start.y };
    c2 = { x: end.x - pull, y: end.y };
  } else {
    const sign = dy >= 0 ? 1 : -1;
    start = {
      x: clampBetween(b.x, from.x + EDGE_MARGIN, rectRight(from) - EDGE_MARGIN),
      y: sign > 0 ? rectBottom(from) : from.y,
    };
    end = {
      x: clampBetween(start.x, to.x + EDGE_MARGIN, rectRight(to) - EDGE_MARGIN),
      y: sign > 0 ? to.y : rectBottom(to),
    };
    const pull = Math.abs(end.y - start.y) * CURVE_PULL * sign;
    c1 = { x: start.x, y: start.y + pull };
    c2 = { x: end.x, y: end.y - pull };
  }
  const round = (n: number): number => Math.round(n * 10) / 10;
  const d = `M${round(start.x)} ${round(start.y)}C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(end.x)} ${round(end.y)}`;
  // Point of a cubic at t = 0.5.
  const mid = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  };
  return { d, mid, start, end };
}

const TASK_MAX = 60;

export interface LinkLabel {
  /** The subagent type ("Explore"). */
  role: string;
  /** What it was asked to do, cut when long; empty when unknown. */
  task: string;
}

/** The label on a line: the subagent type and its task. */
export function linkLabel(agent: Pick<Agent, 'role' | 'roleMsg' | 'title' | 'titleMsg'>): LinkLabel {
  const task = agentTitle(agent)?.trim() ?? '';
  return {
    role: agentRole(agent),
    task: task.length > TASK_MAX ? `${task.slice(0, TASK_MAX - 1).trimEnd()}…` : task,
  };
}
