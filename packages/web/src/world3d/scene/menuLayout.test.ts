import { describe, expect, it } from 'vitest';
import { menuLayout } from './menuLayout';

const W = 512;
const H = 256;
const FRAME = 16;

describe('menuLayout', () => {
  it('places every row and its rule inside the frame, below the title', () => {
    const layout = menuLayout(W, H, 5);
    expect(layout.rowY).toHaveLength(5);
    expect(layout.rowY[0]).toBeGreaterThan(layout.titleRuleY);
    for (const y of layout.rowY) {
      expect(y - layout.rowSize / 2).toBeGreaterThan(FRAME);
      expect(y + layout.rowSize / 2).toBeLessThan(H - FRAME);
    }
    for (const y of layout.ruleY) expect(y).toBeLessThan(H - FRAME);
  });

  it('keeps the rows evenly spaced with room between lines of text', () => {
    const { rowY, rowSize } = menuLayout(W, H, 5);
    const pitches = rowY.slice(1).map((y, i) => y - rowY[i]);
    for (const pitch of pitches) {
      expect(Math.abs(pitch - pitches[0])).toBeLessThanOrEqual(1);
      expect(pitch).toBeGreaterThanOrEqual(rowSize * 1.3);
    }
  });

  it('keeps the title above the rule and inside the frame', () => {
    const layout = menuLayout(W, H, 5);
    expect(layout.titleY - layout.titleSize / 2).toBeGreaterThan(FRAME);
    expect(layout.titleY + layout.titleSize / 2).toBeLessThan(layout.titleRuleY);
  });

  it('draws only the rules between rows and a readable font', () => {
    const layout = menuLayout(W, H, 5);
    expect(layout.ruleY).toHaveLength(4);
    expect(layout.rowSize).toBeGreaterThanOrEqual(22);
    expect(layout.rowMinSize).toBeLessThan(layout.rowSize);
    expect(layout.left).toBeLessThan(layout.right);
  });

  it('scales with the canvas and handles an empty menu', () => {
    const big = menuLayout(W * 2, H * 2, 5);
    expect(Math.abs(big.rowSize - menuLayout(W, H, 5).rowSize * 2)).toBeLessThanOrEqual(1);
    expect(menuLayout(W, H, 0).rowY).toEqual([]);
  });
});
