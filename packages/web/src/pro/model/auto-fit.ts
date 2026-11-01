// "Fit all" that keeps up with the canvas: while the user has not moved the camera since the last fit, the view fits
// again when the content grows past what it fitted (a subagent arrives in a new row, a new session opens). Once the
// user pans, zooms or focuses something, the camera is theirs until they fit all again. Pure.
import { holds } from './layout';
import type { Rect } from './geometry';

export interface AutoFit {
  /** The camera follows the content (on at load and after "fit all"; off once the user moves it). */
  following: boolean;
  /** The bounds the camera last fitted; null before the first fit. */
  fitted: Rect | null;
}

export const AUTO_FIT_START: AutoFit = { following: true, fitted: null };
export const AUTO_FIT_OFF: AutoFit = { following: false, fitted: null };

/** Whether the camera should fit `bounds` now. */
export function shouldRefit(state: AutoFit, bounds: Rect | null): boolean {
  if (!state.following || bounds === null) return false;
  return state.fitted === null || !holds(state.fitted, bounds);
}

/** The state after a fit of `bounds`. */
export function fittedTo(bounds: Rect): AutoFit {
  return { following: true, fitted: bounds };
}
