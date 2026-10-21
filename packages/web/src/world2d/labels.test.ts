import { describe, expect, it } from 'vitest';
import {
  bubblesPerRoom,
  ellipsize,
  fitRoomLabel,
  placeLabels,
  roomPillSlot,
  ROOM_LABEL_METRICS,
  type Box,
  type LabelItem,
  type PlaceOptions,
} from './labels';

/** 6 px per character, so widths are easy to reason about. */
const measure = (text: string): number => text.length * 6;

const screen: Box = { x: 0, y: 0, w: 400, h: 300 };
const base: PlaceOptions = { obstacles: [], clip: screen, gap: 2, groupLimit: 2 };

function item(id: string, priority: number, x: number, y: number, extra: Partial<LabelItem> = {}): LabelItem {
  return { id, priority, w: 60, h: 18, spots: [{ x, y }], ...extra };
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('ellipsize', () => {
  it('keeps text that fits', () => {
    expect(ellipsize('Análise', 100, measure)).toBe('Análise');
  });

  it('cuts with an ellipsis so the result fits the width', () => {
    const out = ellipsize('Escritório Corporativo', 60, measure);
    expect(out.endsWith('…')).toBe(true);
    expect(measure(out)).toBeLessThanOrEqual(60);
    expect(out.length).toBeGreaterThan(3);
  });

  it('returns an empty string when not even one letter fits', () => {
    expect(ellipsize('Escritório', 5, measure)).toBe('');
  });
});

describe('room label fitting', () => {
  const fit = (max: number) => fitRoomLabel('Loja online', '3 agentes', max, measure, measure);

  it('shows name and detail when there is room', () => {
    const r = fit(300);
    expect(r).toMatchObject({ name: 'Loja online', detail: '3 agentes' });
    expect(r.width).toBe(ROOM_LABEL_METRICS.chrome + 66 + ROOM_LABEL_METRICS.gap + 54);
  });

  it('drops the detail before shortening the name', () => {
    const r = fit(100);
    expect(r.name).toBe('Loja online');
    expect(r.detail).toBe('');
    expect(r.width).toBeLessThanOrEqual(100);
  });

  it('shortens the name and never exceeds the available width', () => {
    for (const max of [40, 55, 70, 88]) {
      const r = fit(max);
      expect(r.width).toBeLessThanOrEqual(Math.max(max, ROOM_LABEL_METRICS.dotOnly));
    }
    expect(fit(60).name.endsWith('…')).toBe(true);
  });

  it('collapses to the colour dot in a tiny room', () => {
    expect(fit(10)).toEqual({ name: '', detail: '', width: ROOM_LABEL_METRICS.dotOnly });
  });
});

describe('label placement', () => {
  it('lets the higher priority item win a contested spot and drops the other', () => {
    const placed = placeLabels([item('low', 10, 100, 100), item('high', 50, 110, 105)], base);
    expect(placed.has('high')).toBe(true);
    expect(placed.has('low')).toBe(false);
  });

  it('falls back to the next candidate when the first is taken', () => {
    const second = item('b', 5, 100, 100, {
      spots: [
        { x: 100, y: 100 },
        { x: 100, y: 60 },
      ],
    });
    const placed = placeLabels([item('a', 9, 100, 100), second], base);
    expect(placed.get('b')).toMatchObject({ x: 100, y: 60, overlaps: false });
  });

  it('never leaves two placed labels overlapping, whatever the input', () => {
    const items: LabelItem[] = [];
    for (let i = 0; i < 40; i++) {
      const x = 20 + ((i * 37) % 300);
      const y = 20 + ((i * 53) % 240);
      items.push(
        item(`i${i}`, i % 7, x, y, {
          spots: [
            { x, y },
            { x, y: y - 20 },
            { x: x + 64, y },
          ],
        }),
      );
    }
    const placed = [...placeLabels(items, base)].map(([, p]) => ({ x: p.x, y: p.y, w: 60, h: 18 }));
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false);
  });

  it('keeps labels away from obstacles such as room pills', () => {
    const pill: Box = { x: 90, y: 90, w: 100, h: 20 };
    const placed = placeLabels([item('tag', 10, 100, 95)], { ...base, obstacles: [pill] });
    expect(placed.has('tag')).toBe(false);
  });

  it('shifts labels back inside the screen instead of truncating them', () => {
    const placed = placeLabels([item('edge', 10, 380, -10)], base);
    expect(placed.get('edge')).toMatchObject({ x: 340, y: 0 });
  });

  it('always places required items, overlapping as little as possible', () => {
    const first = item('first', 100, 100, 100, { required: true });
    const second = item('second', 90, 100, 100, {
      required: true,
      spots: [
        { x: 100, y: 100 },
        { x: 130, y: 100 },
      ],
    });
    const placed = placeLabels([first, second], base);
    expect(placed.has('second')).toBe(true);
    expect(placed.get('second')).toMatchObject({ x: 130, overlaps: true });
  });

  it('caps optional items per group but not required ones', () => {
    const items = [0, 1, 2, 3].map((i) => item(`b${i}`, 10 - i, 20 + i * 80, 40, { group: 'room', required: i === 3 }));
    const placed = placeLabels(items, { ...base, groupLimit: 2 });
    expect([...placed.keys()].sort()).toEqual(['b0', 'b1', 'b3']);
  });

  it('places a bubble relative to the placed box of its anchor', () => {
    const tag = item('tag', 20, 100, 100);
    const bubble: LabelItem = {
      id: 'bub',
      priority: 10,
      w: 80,
      h: 24,
      anchorId: 'tag',
      spots: (anchor) => [{ x: 100, y: (anchor ? anchor.y : 120) - 26 }],
    };
    const placed = placeLabels([bubble, tag], base);
    expect(placed.get('bub')).toMatchObject({ y: 74 });
  });

  it('prefers items shown last frame when priorities are equal', () => {
    const a = item('a', 10, 100, 100);
    const b = item('b', 10, 100, 100);
    const placed = placeLabels([a, b], { ...base, kept: new Set(['b']), keepBonus: 5 });
    expect(placed.has('b')).toBe(true);
    expect(placed.has('a')).toBe(false);
  });
});

describe('room pill slot', () => {
  const free: Box = { x: 320, y: 56, w: 1000, h: 800 };

  it('centres the pill in the room and caps its width to the room', () => {
    const slot = roomPillSlot({ x: 500, y: 200, w: 160, h: 190 }, free, 20, 32, 4)!;
    expect(slot.cx).toBe(580);
    expect(slot.maxWidth).toBe(152);
    expect(slot.y).toBe(183);
  });

  it('keeps the pill above the wall decoration at every zoom', () => {
    for (const zoom of [0.4, 0.9, 1.5, 2.5]) {
      const room: Box = { x: 500, y: 200, w: 160, h: 190 * zoom };
      const slot = roomPillSlot(room, free, 20, 32 * zoom, 4 * zoom)!;
      expect(slot.y + 20, `zoom ${zoom}`).toBeLessThanOrEqual(room.y + 4 * zoom);
    }
  });

  it('uses only the part of a room that is outside the side panels', () => {
    const slot = roomPillSlot({ x: 250, y: 200, w: 160, h: 190 }, free, 20, 32, 4)!;
    expect(slot.cx).toBe(365);
    expect(slot.maxWidth).toBe(82);
  });

  it('is null when the room is hidden by a panel or off screen', () => {
    expect(roomPillSlot({ x: 100, y: 200, w: 160, h: 190 }, free, 20, 32, 4)).toBeNull();
    expect(roomPillSlot({ x: 500, y: 900, w: 160, h: 190 }, free, 20, 32, 4)).toBeNull();
  });

  it('keeps the pill visible below the top bar when the room starts above it', () => {
    const slot = roomPillSlot({ x: 500, y: 20, w: 160, h: 190 }, free, 20, 32, 4)!;
    expect(slot.y).toBe(58);
  });

  it('follows the wall instead of covering it while part of the wall is still visible', () => {
    const slot = roomPillSlot({ x: 500, y: 40, w: 160, h: 190 }, free, 20, 32, 4)!;
    expect(slot.y).toBe(23);
  });
});

describe('bubbles per room', () => {
  it('allows more bubbles as the view zooms in', () => {
    expect(bubblesPerRoom(0.6)).toBe(1);
    expect(bubblesPerRoom(1.5)).toBe(2);
    expect(bubblesPerRoom(3)).toBe(3);
  });
});
