import { describe, expect, test } from 'vitest';
import { CLICK_SLOP_PX, isClick, startsFeedDismiss } from './feed-dismiss';

describe('startsFeedDismiss', () => {
  test('starts on a primary press outside an open feed', () => {
    expect(startsFeedDismiss(true, false, 0)).toBe(true);
  });

  test('ignores presses inside the feed or on its toggle', () => {
    expect(startsFeedDismiss(true, true, 0)).toBe(false);
  });

  test('ignores everything while the feed is collapsed', () => {
    expect(startsFeedDismiss(false, false, 0)).toBe(false);
  });

  test('ignores secondary buttons', () => {
    expect(startsFeedDismiss(true, false, 2)).toBe(false);
  });
});

describe('isClick', () => {
  test('is a click when the pointer stays put', () => {
    expect(isClick({ x: 100, y: 100 }, { x: 100, y: 100 })).toBe(true);
  });

  test('is a click within the slop', () => {
    expect(isClick({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(true);
  });

  test('is a drag beyond the slop', () => {
    expect(isClick({ x: 0, y: 0 }, { x: CLICK_SLOP_PX + 1, y: 0 })).toBe(false);
  });
});
