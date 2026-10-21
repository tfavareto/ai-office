// The branch plaque of a project room (2D): a small brass-framed plate hung under the room's sign, with the branch in the
// pixel font, a marker for uncommitted work or an operation in progress, and a CI light when a pull request is open.
import { CI_COLORS, PLAQUE_COLORS, fitBranch, plaqueTone, type RoomGit } from '../../world/roomGit';
import { GLYPH_H, GLYPH_W, drawPixelText, foldText } from '../font';
import { BRASS, EBONY, GRAPHITE } from '../palette';
import { context2d, hline, makeCanvas, rect } from '../paint/ctx';

export const PLAQUE_W = 40;
export const PLAQUE_H = 7;
const MARKER_W = 2;
const LEFT_PAD = 2;
const TEXT_GAP = 2;
const LIGHT_SIZE = 3;
const RIGHT_PAD = 2;
const CHAR_STEP = GLYPH_W + 1;

export interface PlaqueLayout {
  /** The branch as drawn (already folded to the font's alphabet and fitted). */
  text: string;
  textX: number;
  /** Left edge of the CI light, or null without one. */
  lightX: number | null;
}

/** Where things go inside a plaque of `width` px. Pure, so the fitting is testable. */
export function plaqueLayout(info: RoomGit, width = PLAQUE_W): PlaqueLayout {
  const hasLight = info.ci !== 'none';
  const lightX = hasLight ? width - RIGHT_PAD - LIGHT_SIZE : null;
  const textX = LEFT_PAD + MARKER_W + TEXT_GAP;
  const right = lightX === null ? width - RIGHT_PAD : lightX - TEXT_GAP;
  const chars = Math.floor((right - textX + 1) / CHAR_STEP);
  return { text: fitBranch(foldText(info.ref), chars, '.'), textX, lightX };
}

export function renderPlaque(info: RoomGit): HTMLCanvasElement {
  const canvas = makeCanvas(PLAQUE_W, PLAQUE_H);
  const ctx = context2d(canvas);
  const layout = plaqueLayout(info);
  rect(ctx, 0, 0, PLAQUE_W, PLAQUE_H, BRASS.dark);
  rect(ctx, 1, 1, PLAQUE_W - 2, PLAQUE_H - 2, EBONY.base);
  hline(ctx, 1, 0, PLAQUE_W - 2, BRASS.base);
  rect(ctx, LEFT_PAD, 2, MARKER_W, 3, PLAQUE_COLORS[plaqueTone(info)]);
  drawPixelText(ctx, layout.text, layout.textX, Math.floor((PLAQUE_H - GLYPH_H) / 2), info.detached ? GRAPHITE.hi : BRASS.hi);
  if (layout.lightX !== null && info.ci !== 'none') {
    rect(ctx, layout.lightX - 1, 2, LIGHT_SIZE + 2, LIGHT_SIZE, GRAPHITE.deep);
    rect(ctx, layout.lightX, 2, LIGHT_SIZE, LIGHT_SIZE, CI_COLORS[info.ci]);
  }
  return canvas;
}
