// When a pointer press outside the activity feed should collapse it: only a click, not the start of a drag.

/** A press that moves farther than this before it is released is a drag (panning the world), not a click. */
export const CLICK_SLOP_PX = 5;

export interface PointerPoint {
  x: number;
  y: number;
}

export function isClick(down: PointerPoint, up: PointerPoint, slop = CLICK_SLOP_PX): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= slop;
}

/** Whether a press starting on this target is a candidate to collapse the feed (the release decides). */
export function startsFeedDismiss(feedOpen: boolean, insideFeedOrToggle: boolean, button: number): boolean {
  return feedOpen && !insideFeedOrToggle && button === 0;
}
