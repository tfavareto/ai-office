// Panel geometry shared by CSS (through custom properties) and the world insets.
import type { ViewInsets } from '../world/api';

export const TOPBAR_HEIGHT = 56;
export const SIDEBAR_WIDTH = 320;
export const DRAWER_WIDTH = 380;
export const PANEL_GAP = 12;
export const FEED_COLLAPSED_HEIGHT = 40;
export const FEED_EXPANDED_HEIGHT = 200;
/** The time-lapse controls above the feed (one row; two on narrow screens). */
export const REPLAY_BAR_HEIGHT = 124;
export const REPLAY_BAR_NARROW_HEIGHT = 176;

export interface LayoutState {
  sidebarOpen: boolean;
  drawerOpen: boolean;
  feedOpen: boolean;
  narrow: boolean;
  /** A time-lapse is on: its controls take the strip above the feed. */
  replay?: boolean;
}

/** The free area of the screen, i.e. what the panels do not cover. On narrow screens panels are overlays. */
export function computeInsets(state: LayoutState): ViewInsets {
  const feed = state.feedOpen ? FEED_EXPANDED_HEIGHT : FEED_COLLAPSED_HEIGHT;
  const replay = state.replay === true ? (state.narrow ? REPLAY_BAR_NARROW_HEIGHT : REPLAY_BAR_HEIGHT) + PANEL_GAP : 0;
  return {
    top: TOPBAR_HEIGHT,
    left: state.sidebarOpen && !state.narrow ? SIDEBAR_WIDTH + 2 * PANEL_GAP : 0,
    right: state.drawerOpen && !state.narrow ? DRAWER_WIDTH + 2 * PANEL_GAP : 0,
    bottom: feed + 2 * PANEL_GAP + replay,
  };
}

export function sameInsets(a: ViewInsets, b: ViewInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

export function layoutVariables(): Record<string, string> {
  return {
    '--topbar-h': `${TOPBAR_HEIGHT}px`,
    '--sidebar-w': `${SIDEBAR_WIDTH}px`,
    '--drawer-w': `${DRAWER_WIDTH}px`,
    '--gap': `${PANEL_GAP}px`,
    '--feed-collapsed-h': `${FEED_COLLAPSED_HEIGHT}px`,
    '--feed-expanded-h': `${FEED_EXPANDED_HEIGHT}px`,
  };
}
