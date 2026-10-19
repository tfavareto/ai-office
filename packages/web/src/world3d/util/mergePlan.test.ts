import { describe, expect, it } from 'vitest';
import { planMerge, savedDrawCalls } from './mergePlan';

describe('planMerge', () => {
  it('groups parts by material key keeping input order', () => {
    const items = [
      { key: 'wood', vertices: 24 }, { key: 'glass', vertices: 4 }, { key: 'wood', vertices: 24 }, { key: 'brass', vertices: 8 }, { key: 'glass', vertices: 4 },
    ];
    const batches = planMerge(items);
    expect(batches).toHaveLength(3);
    expect(batches.find((b) => b.key === 'wood')?.items).toEqual([0, 2]);
    expect(batches.find((b) => b.key === 'glass')?.items).toEqual([1, 4]);
    expect(savedDrawCalls(items, batches)).toBe(2);
  });

  it('splits a material when the vertex budget is exceeded', () => {
    const items = Array.from({ length: 5 }, () => ({ key: 'm', vertices: 40 }));
    const batches = planMerge(items, 100);
    expect(batches.map((b) => b.items.length).sort()).toEqual([1, 2, 2]);
    expect(batches.every((b) => b.vertices <= 100)).toBe(true);
  });

  it('keeps every item exactly once', () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ key: `k${i % 7}`, vertices: 10 + (i % 5) }));
    const seen = planMerge(items, 60).flatMap((b) => b.items).sort((a, b) => a - b);
    expect(seen).toEqual(items.map((_, i) => i));
  });

  it('returns nothing for no parts', () => {
    expect(planMerge([])).toEqual([]);
  });
});
