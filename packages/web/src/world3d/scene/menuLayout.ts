// Pure layout of the pantry menu board (a w x h px texture): title band on top, then one row per item, all inside
// the frame. Proportional to the canvas so a different texture size keeps every row visible.

export interface MenuLayout {
  /** Left and right text edges of the rows. */
  left: number;
  right: number;
  titleSize: number;
  titleY: number;
  /** Y of the rule under the title. */
  titleRuleY: number;
  rowSize: number;
  /** Smallest font size an item name may shrink to before it is truncated. */
  rowMinSize: number;
  /** Centre line of each row. */
  rowY: number[];
  /** Y of the rule under each row (none under the last one). */
  ruleY: number[];
}

const MARGIN_X = 0.1;
const TITLE_Y = 0.155;
const TITLE_SIZE = 0.135;
const CONTENT_TOP = 0.285;
const CONTENT_BOTTOM = 0.925;
const ROW_SIZE_PER_PITCH = 0.72;
const ROW_MIN_PER_PITCH = 0.5;

export function menuLayout(w: number, h: number, rows: number): MenuLayout {
  const top = h * CONTENT_TOP;
  const pitch = rows > 0 ? (h * CONTENT_BOTTOM - top) / rows : 0;
  const rowY = Array.from({ length: rows }, (_, i) => Math.round(top + (i + 0.5) * pitch));
  return {
    left: Math.round(w * MARGIN_X),
    right: Math.round(w * (1 - MARGIN_X)),
    titleSize: Math.round(h * TITLE_SIZE),
    titleY: Math.round(h * TITLE_Y),
    titleRuleY: Math.round(top - pitch * 0.12),
    rowSize: Math.floor(pitch * ROW_SIZE_PER_PITCH),
    rowMinSize: Math.floor(pitch * ROW_MIN_PER_PITCH),
    rowY,
    ruleY: rowY.slice(0, -1).map((y) => Math.round(y + pitch / 2)),
  };
}
