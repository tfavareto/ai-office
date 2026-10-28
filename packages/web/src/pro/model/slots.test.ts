import { describe, expect, it } from 'vitest';
import { rectsOverlap, type Rect } from './geometry';
import {
  MAX_RING,
  ORCHESTRATOR_SIZE,
  clusterFootprint,
  orchestratorRect,
  ringOfSlot,
  separation,
  slotCount,
  slotRect,
} from './slots';

const CENTER = { x: 0, y: 0 };

describe('subagent slots', () => {
  it('holds six slots in the first ring, eight more in the second and ten in the third', () => {
    expect(slotCount(0)).toBe(0);
    expect(slotCount(1)).toBe(6);
    expect(slotCount(2)).toBe(14);
    expect(slotCount(3)).toBe(24);
    expect(ringOfSlot(0)).toBe(1);
    expect(ringOfSlot(5)).toBe(1);
    expect(ringOfSlot(6)).toBe(2);
    expect(ringOfSlot(13)).toBe(2);
    expect(ringOfSlot(14)).toBe(3);
  });

  it('puts the first subagents on the right and on the left, then above and below in the second ring', () => {
    const center = (slot: number): { x: number; y: number } => {
      const rect = slotRect(CENTER, slot);
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    expect(center(0).x).toBeGreaterThan(0);
    expect(center(0).y).toBe(0);
    expect(center(1).x).toBeLessThan(0);
    expect(center(2).y).toBeLessThan(0);
    expect(center(6)).toEqual({ x: 0, y: expect.any(Number) });
    expect(center(6).y).toBeLessThan(0);
    expect(center(7).y).toBeGreaterThan(0);
  });

  it('never overlaps two terminals or a terminal with the orchestrator, ring after ring', () => {
    const rects: Rect[] = [orchestratorRect(CENTER)];
    for (let slot = 0; slot < slotCount(MAX_RING); slot++) rects.push(slotRect(CENTER, slot));
    for (let a = 0; a < rects.length; a++)
      for (let b = a + 1; b < rects.length; b++)
        expect(rectsOverlap(rects[a] as Rect, rects[b] as Rect), `rects ${a} and ${b}`).toBe(false);
  });

  it('keeps room for a line between the orchestrator and the first ring', () => {
    const orchestrator = orchestratorRect(CENTER);
    for (let slot = 0; slot < slotCount(1); slot++)
      expect(separation(slotRect(CENTER, slot), orchestrator)).toBeGreaterThanOrEqual(40);
  });

  it('reserves a footprint that holds every slot of its ring and grows with it', () => {
    const alone = clusterFootprint(CENTER, 0);
    expect(alone.width).toBe(ORCHESTRATOR_SIZE.width);
    const first = clusterFootprint(CENTER, 1);
    const second = clusterFootprint(CENTER, 2);
    expect(first.width).toBeGreaterThan(alone.width);
    expect(second.width).toBeGreaterThan(first.width);
    for (let slot = 0; slot < slotCount(2); slot++) {
      const rect = slotRect(CENTER, slot);
      expect(rect.x).toBeGreaterThanOrEqual(second.x);
      expect(rect.x + rect.width).toBeLessThanOrEqual(second.x + second.width);
    }
  });
});
