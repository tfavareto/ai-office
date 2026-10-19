// Decides how the usage cards of the top bar fit the room they have: full cards, compact cards, or as many compact
// cards as fit plus a "+N" button. Pure: the component measures the DOM and applies the result.

export interface UsageFitInput {
  /** Width available to the whole usage strip, in px. */
  available: number;
  /** Gap between two items, in px. */
  gap: number;
  /** Natural width of each card in its full form. */
  full: readonly number[];
  /** Natural width of each card in its compact form. */
  compact: readonly number[];
  /** Width of the "+N" button. */
  more: number;
}

export interface UsageFit {
  compact: boolean;
  /** How many cards (from the first) stay in the bar; the rest go to the overflow popover. */
  visible: number;
  /** Whether the "+N" button is shown (always when some cards are left out and it fits). */
  showMore: boolean;
}

function rowWidth(widths: readonly number[], gap: number): number {
  if (widths.length === 0) return 0;
  return widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
}

export function fitUsageCards({ available, gap, full, compact, more }: UsageFitInput): UsageFit {
  const count = compact.length;
  if (count === 0) return { compact: false, visible: 0, showMore: false };
  if (rowWidth(full, gap) <= available) return { compact: false, visible: count, showMore: false };
  if (rowWidth(compact, gap) <= available) return { compact: true, visible: count, showMore: false };
  for (let visible = count - 1; visible >= 0; visible -= 1) {
    if (rowWidth(compact.slice(0, visible), gap) + (visible > 0 ? gap : 0) + more <= available) return { compact: true, visible, showMore: true };
  }
  return { compact: true, visible: 0, showMore: false };
}
