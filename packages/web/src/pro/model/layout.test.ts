import { describe, expect, it } from 'vitest';
import { rectsOverlap, type Rect } from './geometry';
import { computeLayout, holds, type LayoutCluster, type LayoutRoom, ROW_MAX_WIDTH } from './layout';

function cluster(id: string, subs: string[] = [], rows = Math.ceil(subs.length / 3)): LayoutCluster {
  return { id, rows, slots: Object.fromEntries(subs.map((sub, index) => [sub, index])) };
}

const ROOMS: LayoutRoom[] = [
  { id: 'r1', clusters: [cluster('a', ['a1', 'a2', 'a3']), cluster('b', ['b1'])] },
  { id: 'r2', clusters: [cluster('c', ['c1', 'c2'])] },
  { id: 'r3', clusters: [cluster('d'), cluster('e', ['e1']), cluster('f', [], 1)] },
  { id: 'r4', clusters: [cluster('g', ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9'], 3)] },
];

describe('computeLayout', () => {
  it('is deterministic', () => {
    const first = computeLayout(ROOMS);
    const second = computeLayout(ROOMS);
    expect([...first.nodes]).toEqual([...second.nodes]);
    expect(first.frames).toEqual(second.frames);
  });

  it('places every terminal without overlapping any other', () => {
    const { nodes } = computeLayout(ROOMS);
    const entries = [...nodes.entries()];
    expect(entries.length).toBe(23);
    for (let a = 0; a < entries.length; a++)
      for (let b = a + 1; b < entries.length; b++)
        expect(
          rectsOverlap(entries[a]?.[1] as Rect, entries[b]?.[1] as Rect),
          `${entries[a]?.[0]} / ${entries[b]?.[0]}`,
        ).toBe(false);
  });

  it('draws one frame per room that holds all its terminals and never overlaps another frame', () => {
    const layout = computeLayout(ROOMS);
    expect(layout.frames.map((frame) => frame.roomId)).toEqual(['r1', 'r2', 'r3', 'r4']);
    for (const placement of layout.clusters) {
      const frame = layout.frames.find((candidate) => candidate.roomId === placement.roomId);
      expect(frame && holds(frame.rect, placement.footprint), placement.id).toBe(true);
    }
    for (let a = 0; a < layout.frames.length; a++)
      for (let b = a + 1; b < layout.frames.length; b++)
        expect(rectsOverlap(layout.frames[a]?.rect as Rect, layout.frames[b]?.rect as Rect)).toBe(false);
  });

  it('starts a new row of frames instead of passing the maximum width', () => {
    const layout = computeLayout(ROOMS);
    const widest = Math.max(...layout.frames.map((frame) => frame.rect.x + frame.rect.width));
    expect(widest).toBeLessThanOrEqual(ROW_MAX_WIDTH);
    expect(new Set(layout.frames.map((frame) => frame.rect.y)).size).toBeGreaterThan(1);
  });

  it('keeps every position when subagents come and go inside the rows a cluster already reserved', () => {
    const before = computeLayout(ROOMS);
    const fewer = computeLayout([
      { ...(ROOMS[0] as LayoutRoom), clusters: [cluster('a', ['a2'], 1), cluster('b', [], 1)] },
      ...ROOMS.slice(1),
    ]);
    expect(fewer.nodes.get('c')).toEqual(before.nodes.get('c'));
    expect(fewer.nodes.get('g')).toEqual(before.nodes.get('g'));
    expect(fewer.nodes.get('a')).toEqual(before.nodes.get('a'));
    // The subagent that stayed keeps its slot, so it keeps its place.
    const slotOfA2 = { id: 'a2', slot: 1 };
    const kept = computeLayout([
      { id: 'r1', clusters: [{ id: 'a', rows: 1, slots: { [slotOfA2.id]: slotOfA2.slot } }] },
    ]);
    const original = computeLayout([{ id: 'r1', clusters: [cluster('a', ['a1', 'a2', 'a3'])] }]);
    expect(kept.nodes.get('a2')).toEqual(original.nodes.get('a2'));
  });

  it('applies a dragged cluster and a dragged terminal, and the frame follows', () => {
    const base = computeLayout(ROOMS);
    const moved = computeLayout(ROOMS, { clusters: { a: { x: 300, y: -200 } }, panels: { a1: { x: 10, y: 20 } } });
    const baseA = base.nodes.get('a') as Rect;
    const movedA = moved.nodes.get('a') as Rect;
    expect(movedA.x - baseA.x).toBe(300);
    expect(movedA.y - baseA.y).toBe(-200);
    const baseA1 = base.nodes.get('a1') as Rect;
    const movedA1 = moved.nodes.get('a1') as Rect;
    expect(movedA1.x - baseA1.x).toBe(310);
    expect(movedA1.y - baseA1.y).toBe(-180);
    const frame = moved.frames.find((candidate) => candidate.roomId === 'r1');
    for (const id of ['a', 'a1', 'a2', 'a3', 'b', 'b1'])
      expect(frame && holds(frame.rect, moved.nodes.get(id) as Rect), id).toBe(true);
    // Other rooms did not move.
    expect(moved.nodes.get('c')).toEqual(base.nodes.get('c'));
  });

  it('puts the subagents under their orchestrator and the orchestrators of a room side by side', () => {
    // Act
    const layout = computeLayout(ROOMS);

    // Assert
    const a = layout.nodes.get('a') as Rect;
    const b = layout.nodes.get('b') as Rect;
    for (const sub of ['a1', 'a2', 'a3']) {
      const rect = layout.nodes.get(sub) as Rect;
      expect(rect.y, sub).toBeGreaterThan(a.y + a.height);
      expect(rect.x + rect.width / 2, sub).toBeGreaterThan(a.x - 200);
      expect(rect.x + rect.width / 2, sub).toBeLessThan(a.x + a.width + 200);
    }
    expect(b.y).toBe(a.y);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    const g = layout.nodes.get('g') as Rect;
    const g9 = layout.nodes.get('g9') as Rect;
    expect(g9.y).toBeGreaterThan((layout.nodes.get('g4') as Rect).y);
    expect(g9.y).toBeGreaterThan(g.y + g.height);
  });

  it('moves no terminal of a room when a cluster gains its first subagent or a new row', () => {
    // Arrange
    const room = (subs: string[]): LayoutRoom[] => [
      { id: 'r1', clusters: [cluster('a', subs), cluster('b', ['b1'])] },
      { id: 'r2', clusters: [cluster('c', ['c1'])] },
    ];
    const before = computeLayout(room([]));

    // Act
    const after = computeLayout(room(['a1', 'a2', 'a3', 'a4']));

    // Assert
    for (const id of ['a', 'b', 'b1', 'c', 'c1']) expect(after.nodes.get(id), id).toEqual(before.nodes.get(id));
  });

  it('skips rooms without clusters and reports no bounds when empty', () => {
    expect(computeLayout([{ id: 'empty', clusters: [] }]).frames).toEqual([]);
    expect(computeLayout([]).bounds).toBeNull();
    expect(computeLayout(ROOMS).bounds).not.toBeNull();
  });
});
