import { describe, expect, it } from 'vitest';
import {
  COMMAND_BAR_HEIGHT,
  COMMAND_BAR_NARROW_HEIGHT,
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

  it('gives the feed strip back to the Pro canvas, whether the feed is open or not', () => {
    expect(computeInsets({ ...base, pro: true }).bottom).toBe(PANEL_GAP);
    expect(computeInsets({ ...base, pro: true, feedOpen: true }).bottom).toBe(PANEL_GAP);
    expect(computeInsets({ ...base, pro: false }).bottom).toBe(computeInsets(base).bottom);
  });

  it('leaves room for the Pro command bar only while it is shown, a taller one on narrow screens', () => {
    expect(computeInsets({ ...base, pro: true, commandBar: true }).bottom).toBe(
      PANEL_GAP + COMMAND_BAR_HEIGHT + PANEL_GAP,
    );
    expect(computeInsets({ ...base, narrow: true, pro: true, commandBar: true }).bottom).toBe(
      PANEL_GAP + COMMAND_BAR_NARROW_HEIGHT + PANEL_GAP,
    );
    expect(computeInsets({ ...base, pro: true, commandBar: false }).bottom).toBe(PANEL_GAP);
    expect(computeInsets({ ...base, commandBar: true }).bottom).toBe(computeInsets(base).bottom);
  });

  it('keeps the side panels out of the free area only on wide screens', () => {
    expect(computeInsets({ ...base, sidebarOpen: true }).left).toBeGreaterThan(0);
    expect(computeInsets({ ...base, sidebarOpen: true, narrow: true }).left).toBe(0);
  });
});
