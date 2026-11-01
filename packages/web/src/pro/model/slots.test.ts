import { describe, expect, it } from 'vitest';
import { rectBottom, rectCenter, rectsOverlap, type Rect } from './geometry';
import {
  CLUSTER_WIDTH,
  MAX_SLOTS,
  ORCHESTRATOR_SIZE,
  SUB_COLUMNS,
  clusterFootprint,
  orchestratorRect,
  rowsForSlot,
  separation,
  slotCell,
  slotRect,
} from './slots';

const CENTER = { x: 0, y: 0 };

describe('subagent slots', () => {
  it('fills rows of three under the orchestrator: the middle first, then the left, then the right', () => {
    expect(SUB_COLUMNS).toBe(3);
    expect(slotCell(0)).toEqual({ row: 0, column: 1 });
    expect(slotCell(1)).toEqual({ row: 0, column: 0 });
    expect(slotCell(2)).toEqual({ row: 0, column: 2 });
    expect(slotCell(3)).toEqual({ row: 1, column: 1 });
    expect(rowsForSlot(0)).toBe(1);
    expect(rowsForSlot(2)).toBe(1);
    expect(rowsForSlot(3)).toBe(2);
  });

  it('puts every subagent below its orchestrator and the first one right under its middle', () => {
    // Arrange
    const orchestrator = orchestratorRect(CENTER);

    // Act
    const first = slotRect(CENTER, 0);

    // Assert
    expect(rectCenter(first).x).toBe(0);
    for (let slot = 0; slot < MAX_SLOTS; slot++)
      expect(slotRect(CENTER, slot).y).toBeGreaterThan(rectBottom(orchestrator));
    expect(rectCenter(slotRect(CENTER, 1)).x).toBeLessThan(0);
    expect(rectCenter(slotRect(CENTER, 2)).x).toBeGreaterThan(0);
    expect(slotRect(CENTER, 3).y).toBeGreaterThan(rectBottom(first));
  });

  it('never overlaps two terminals or a terminal with the orchestrator, row after row', () => {
    const rects: Rect[] = [orchestratorRect(CENTER)];
    for (let slot = 0; slot < MAX_SLOTS; slot++) rects.push(slotRect(CENTER, slot));
    for (let a = 0; a < rects.length; a++)
      for (let b = a + 1; b < rects.length; b++)
        expect(rectsOverlap(rects[a] as Rect, rects[b] as Rect), `rects ${a} and ${b}`).toBe(false);
  });

  it('keeps room for the connector between the orchestrator and the first row', () => {
    const orchestrator = orchestratorRect(CENTER);
    for (let slot = 0; slot < SUB_COLUMNS; slot++)
      expect(separation(slotRect(CENTER, slot), orchestrator)).toBeGreaterThanOrEqual(60);
  });

  it('reserves the same width with or without subagents and grows only downward', () => {
    // Act
    const alone = clusterFootprint(CENTER, 0);
    const one = clusterFootprint(CENTER, 1);
    const two = clusterFootprint(CENTER, 2);

    // Assert
    expect(alone.height).toBe(ORCHESTRATOR_SIZE.height);
    expect([alone.width, one.width, two.width]).toEqual([CLUSTER_WIDTH, CLUSTER_WIDTH, CLUSTER_WIDTH]);
    expect([alone.y, one.y, two.y]).toEqual([alone.y, alone.y, alone.y]);
    expect(two.height).toBeGreaterThan(one.height);
    for (let slot = 0; slot < 2 * SUB_COLUMNS; slot++) {
      const rect = slotRect(CENTER, slot);
      expect(rect.x).toBeGreaterThanOrEqual(two.x);
      expect(rect.x + rect.width).toBeLessThanOrEqual(two.x + two.width);
      expect(rectBottom(rect)).toBeLessThanOrEqual(rectBottom(two));
    }
  });
});
