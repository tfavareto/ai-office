import { describe, expect, it } from 'vitest';
import type { WallItem, WallKind } from '../../layout/types';
import { paintWallItem, WALL_ITEMS_TOP } from './wallitems';

const KINDS: WallKind[] = [
  'sign',
  'logoSign',
  'board',
  'tv',
  'menu',
  'whiteboard',
  'elevator',
  'mirror',
  'poster',
  'clock',
];

/** A context that only records the top row of everything it fills. */
function topRowRecorder(): { ctx: CanvasRenderingContext2D; top: () => number } {
  let top = Infinity;
  const ctx = {
    fillRect: (_x: number, y: number) => {
      top = Math.min(top, y);
    },
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  return { ctx, top: () => top };
}

describe('wall items', () => {
  it.each(KINDS)('keeps %s at or below the line the room pills stay above', (kind) => {
    for (const w of [3, 6]) {
      const { ctx, top } = topRowRecorder();
      const item: WallItem = { id: 'x', kind, side: 'north', x: 0, w, variant: 0 };
      paintWallItem(ctx, item, 0, 'Room', '#6ea2ff');
      expect(top(), `${kind} w=${w}`).toBeGreaterThanOrEqual(WALL_ITEMS_TOP);
    }
  });
});
