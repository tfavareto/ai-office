import { describe, expect, it } from 'vitest';
import {
  EMPTY_POSITIONS,
  POSITIONS_KEY,
  loadPositions,
  parsePositions,
  parsePositionsJson,
  savePositions,
  withClusterOffset,
  withPanelOffset,
  type StorageLike,
} from './positions';

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(initial === undefined ? [] : [[POSITIONS_KEY, initial]]);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('parsePositions', () => {
  it('keeps well-formed offsets, rounded', () => {
    expect(parsePositions({ clusters: { a: { x: 10.4, y: -3.6 } }, panels: { b: { x: 5, y: 6 } } })).toEqual({
      clusters: { a: { x: 10, y: -4 } },
      panels: { b: { x: 5, y: 6 } },
    });
  });

  it('drops anything malformed, huge, empty-keyed or zero', () => {
    const parsed = parsePositions({
      clusters: {
        ok: { x: 1, y: 1 },
        text: { x: '1', y: 2 },
        nan: { x: Number.NaN, y: 2 },
        far: { x: 1e9, y: 0 },
        zero: { x: 0, y: 0 },
        '': { x: 1, y: 1 },
        [`k${'x'.repeat(300)}`]: { x: 1, y: 1 },
        missing: null,
      },
      panels: 'nope',
    });
    expect(parsed).toEqual({ clusters: { ok: { x: 1, y: 1 } }, panels: {} });
  });

  it('falls back to nothing for junk', () => {
    expect(parsePositions(null)).toBe(EMPTY_POSITIONS);
    expect(parsePositions([1, 2])).toBe(EMPTY_POSITIONS);
    expect(parsePositionsJson('{not json')).toBe(EMPTY_POSITIONS);
    expect(parsePositionsJson(null)).toBe(EMPTY_POSITIONS);
  });

  it('caps how many offsets it remembers', () => {
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`id${i}`, { x: i + 1, y: 1 }]));
    const parsed = parsePositions({ clusters: many });
    expect(Object.keys(parsed.clusters)).toHaveLength(300);
    expect(parsed.clusters.id499).toBeDefined();
  });
});

describe('remembering offsets', () => {
  it('adds, replaces and forgets without touching the original', () => {
    const start = withClusterOffset(EMPTY_POSITIONS, 'a', { x: 5, y: 5 });
    expect(EMPTY_POSITIONS.clusters).toEqual({});
    const moved = withClusterOffset(start, 'a', { x: 9, y: 9 });
    expect(moved.clusters.a).toEqual({ x: 9, y: 9 });
    expect(start.clusters.a).toEqual({ x: 5, y: 5 });
    expect(withClusterOffset(moved, 'a', { x: 0, y: 0 }).clusters).toEqual({});
    expect(withPanelOffset(EMPTY_POSITIONS, 'p', { x: 1, y: 2 }).panels.p).toEqual({ x: 1, y: 2 });
  });
});

describe('storage', () => {
  it('saves and loads what it saved, and removes the key when nothing is left', () => {
    const storage = memoryStorage();
    const positions = withPanelOffset(EMPTY_POSITIONS, 'p', { x: 3, y: 4 });
    expect(savePositions(positions, storage)).toBe(true);
    expect(loadPositions(storage)).toEqual(positions);
    savePositions(EMPTY_POSITIONS, storage);
    expect(storage.data.has(POSITIONS_KEY)).toBe(false);
  });

  it('survives a storage that throws or is missing', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    expect(loadPositions(broken)).toBe(EMPTY_POSITIONS);
    expect(savePositions(withPanelOffset(EMPTY_POSITIONS, 'p', { x: 1, y: 1 }), broken)).toBe(false);
    expect(loadPositions(null)).toBe(EMPTY_POSITIONS);
    expect(savePositions(EMPTY_POSITIONS, null)).toBe(false);
  });
});
