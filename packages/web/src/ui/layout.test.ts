import { describe, expect, it } from 'vitest';
import {
  FEED_COLLAPSED_HEIGHT,
  FEED_EXPANDED_HEIGHT,
  PANEL_GAP,
  REPLAY_BAR_HEIGHT,
  REPLAY_BAR_NARROW_HEIGHT,
  computeInsets,
} from './layout';

const base = { sidebarOpen: false, drawerOpen: false, feedOpen: false, narrow: false };

describe('computeInsets', () => {
  it('leaves room for the feed, and more when it is open', () => {
    expect(computeInsets(base).bottom).toBe(FEED_COLLAPSED_HEIGHT + 2 * PANEL_GAP);
    expect(computeInsets({ ...base, feedOpen: true }).bottom).toBe(FEED_EXPANDED_HEIGHT + 2 * PANEL_GAP);
  });

  it('leaves room for the time-lapse controls above the feed, a taller bar on narrow screens', () => {
    expect(computeInsets({ ...base, replay: true }).bottom).toBe(
      FEED_COLLAPSED_HEIGHT + 2 * PANEL_GAP + REPLAY_BAR_HEIGHT + PANEL_GAP,
    );
    expect(computeInsets({ ...base, narrow: true, replay: true }).bottom).toBe(
      FEED_COLLAPSED_HEIGHT + 2 * PANEL_GAP + REPLAY_BAR_NARROW_HEIGHT + PANEL_GAP,
    );
    expect(computeInsets({ ...base, replay: false }).bottom).toBe(computeInsets(base).bottom);
  });

  it('keeps the side panels out of the free area only on wide screens', () => {
    expect(computeInsets({ ...base, sidebarOpen: true }).left).toBeGreaterThan(0);
    expect(computeInsets({ ...base, sidebarOpen: true, narrow: true }).left).toBe(0);
  });
});
