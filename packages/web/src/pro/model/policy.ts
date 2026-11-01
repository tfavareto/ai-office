// Which terminals of the canvas load and render their conversation, and how often they poll. Terminals far off the
// screen or too small to read stay quiet; the rest are ranked and only the best few are live, because every live
// terminal is a transcript the local server keeps open and re-reads.
import type { DisplayStatus } from '../../ui/model/status';
import { rectCenter, rectsOverlap, type Point, type Rect } from './geometry';

/**
 * live: reads its conversation and polls · summary: rests, showing the lines it already has and the activities the
 * office saw (terminal text all the same, no requests) · hidden: off screen, not rendered.
 */
export type Detail = 'live' | 'summary' | 'hidden';

/** A terminal is readable from this width on the screen (px). */
export const LIVE_MIN_SCREEN_WIDTH = 170;
/** Below this zoom no terminal is read live, whatever its size: the text would be too small to read. */
export const LIVE_MIN_ZOOM = 0.45;
/** Terminals that may be live at once (the server keeps a few more transcripts open than this). */
export const MAX_LIVE_TERMINALS = 10;
/** A busy terminal on screen shows what its agent wrote within this time (the office's own updates also nudge it). */
export const POLL_ACTIVE_MS = 700;
export const POLL_CALM_MS = 3000;
/** The visible area is widened by this many screen pixels, so terminals about to come in start loading. */
export const VISIBLE_MARGIN_PX = 160;

export interface PolicyNode {
  id: string;
  /** World rectangle of the terminal. */
  rect: Rect;
  status: DisplayStatus;
  /** Selected in the office, focused on the canvas or maximized. */
  focused: boolean;
  /** A subagent that already finished (its conversation will not change). */
  finished: boolean;
  isOrchestrator: boolean;
}

export interface PolicyInput {
  nodes: readonly PolicyNode[];
  /** The part of the world on screen, already widened by the margin. */
  visible: Rect;
  zoom: number;
  /** Reading sessions is not available (the page is not local): every terminal on screen rests. */
  paused: boolean;
  maxLive?: number;
}

export interface NodePolicy {
  detail: Detail;
  /** Milliseconds between polls; 0 = load once and stop (finished terminals) or do not poll at all. */
  pollMs: number;
}

export function pollFor(status: DisplayStatus, finished: boolean): number {
  if (finished || status === 'done' || status === 'offline') return 0;
  return status === 'working' || status === 'waiting' || status === 'shell' ? POLL_ACTIVE_MS : POLL_CALM_MS;
}

/** Order of preference for the live slots: what the user is looking at, who is busy, orchestrators, who is closest. */
function priority(node: PolicyNode, center: Point): number[] {
  const busy = node.status === 'working' || node.status === 'waiting' || node.status === 'shell' ? 0 : 1;
  const here = rectCenter(node.rect);
  return [
    node.focused ? 0 : 1,
    node.finished ? 1 : 0,
    busy,
    node.isOrchestrator ? 0 : 1,
    Math.hypot(here.x - center.x, here.y - center.y),
  ];
}

function compare(a: number[], b: number[]): number {
  for (let index = 0; index < a.length; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function planTerminals(input: PolicyInput): ReadonlyMap<string, NodePolicy> {
  const center = rectCenter(input.visible);
  const maxLive = input.maxLive ?? MAX_LIVE_TERMINALS;
  const plan = new Map<string, NodePolicy>();
  const candidates: PolicyNode[] = [];
  for (const node of input.nodes) {
    if (!rectsOverlap(node.rect, input.visible)) plan.set(node.id, { detail: 'hidden', pollMs: 0 });
    else if (input.paused || input.zoom < LIVE_MIN_ZOOM || node.rect.width * input.zoom < LIVE_MIN_SCREEN_WIDTH)
      plan.set(node.id, { detail: 'summary', pollMs: 0 });
    else candidates.push(node);
  }
  const ranked = candidates
    .map((node) => ({ node, rank: priority(node, center) }))
    .sort((a, b) => compare(a.rank, b.rank));
  ranked.forEach(({ node }, index) => {
    plan.set(
      node.id,
      index < maxLive
        ? { detail: 'live', pollMs: pollFor(node.status, node.finished) }
        : { detail: 'summary', pollMs: 0 },
    );
  });
  return plan;
}
