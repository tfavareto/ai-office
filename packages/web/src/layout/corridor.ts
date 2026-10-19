import { CORRIDOR_H, CORRIDOR_Y } from './constants';
import type { AreaLayout, Dir, Door, FurnitureItem, FurnitureKind, Rect, Spot, SpotKind } from './types';

const SEGMENT = 16;
const NORTH_ROW = CORRIDOR_Y;
const SOUTH_ROW = CORRIDOR_Y + CORRIDOR_H - 1;
const MID_ROW = CORRIDOR_Y + 2;

/**
 * The corridor between the two room rows: light stone floor, runner rugs, benches, water coolers and tall plants. Items
 * repeat every 16 tiles and never stand in front of a door, so every door stays reachable.
 */
export function layoutCorridor(endX: number, doors: readonly Door[]): AreaLayout {
  const rect: Rect = { x: 1, y: CORRIDOR_Y, w: Math.max(1, endX - 1), h: CORRIDOR_H };
  const furniture: FurnitureItem[] = [];
  const spots: Spot[] = [];
  let counter = 0;

  const doorBlocks = (x: number, w: number, y: number): boolean =>
    doors.some((d) => d.outside.y === y && x < d.rect.x + d.rect.w + 1 && x + w > d.rect.x - 1);

  const put = (kind: FurnitureKind, x: number, y: number, w: number, facing: Dir, opts: { walk?: boolean; variant?: number } = {}): FurnitureItem | null => {
    if (x < rect.x + 1 || x + w > rect.x + rect.w - 1) return null;
    if (!opts.walk && doorBlocks(x, w, y)) return null;
    const item: FurnitureItem = {
      id: `corridor:${kind}${counter++}`,
      kind,
      x,
      y,
      w,
      h: 1,
      variant: opts.variant ?? 0,
      facing,
      rotation: facing === 'n' ? 0 : facing === 'e' ? 90 : facing === 's' ? 180 : 270,
      blocks: opts.walk ? [] : [{ x, y, w, h: 1 }],
      tall: kind === 'plantTall' || kind === 'waterCooler' || kind === 'plant',
    };
    furniture.push(item);
    return item;
  };

  const spot = (kind: SpotKind, x: number, y: number, dir: Dir, approach: { x: number; y: number }, opts: Partial<Spot> = {}): void => {
    spots.push({ id: `corridor:${kind}${counter++}`, kind, areaId: 'corridor', x, y, dir, seat: false, approach, ...opts });
  };

  const segments = Math.floor(rect.w / SEGMENT) + 1;
  for (let s = 0; s < segments; s++) {
    const base = rect.x + s * SEGMENT;
    put('rug', base + 1, MID_ROW, 14, 'e', { walk: true, variant: s % 2 });
    const benchN = put('bench', base + 4, NORTH_ROW, 2, 's');
    if (benchN) {
      for (let i = 0; i < 2; i++) {
        spot('bench', base + 4 + i + 0.5, NORTH_ROW + 0.6, 's', { x: base + 4 + i, y: NORTH_ROW + 1 }, { seat: true, itemId: benchN.id });
      }
    }
    const cooler = put('waterCooler', base + 11, NORTH_ROW, 1, 's');
    if (cooler) spot('cooler', base + 11.5, NORTH_ROW + 1.6, 'n', { x: base + 11, y: NORTH_ROW + 1 });
    put('plantTall', base + 2, SOUTH_ROW, 1, 'n', { variant: s % 2 });
    put('plantTall', base + 14, SOUTH_ROW, 1, 'n', { variant: (s + 1) % 2 });
    const benchS = put('bench', base + 7, SOUTH_ROW, 2, 'n');
    if (benchS) {
      for (let i = 0; i < 2; i++) {
        spot('bench', base + 7 + i + 0.5, SOUTH_ROW + 0.6, 'n', { x: base + 7 + i, y: SOUTH_ROW - 1 }, { seat: true, itemId: benchS.id });
      }
    }
    const tx = base + 6;
    if (tx + 1 < rect.x + rect.w) {
      const group = `corridor-talk${s}`;
      spot('talk', tx + 0.5, MID_ROW + 0.55, 'e', { x: tx, y: MID_ROW }, { group });
      spot('talk', tx + 1.5, MID_ROW + 0.55, 'w', { x: tx + 1, y: MID_ROW }, { group });
    }
  }

  return {
    id: 'corridor',
    kind: 'corridor',
    label: 'Corredor',
    row: 'corridor',
    rect,
    wall: { x: rect.x, y: rect.y, w: rect.w, h: 0 },
    floor: rect,
    ledge: null,
    furniture,
    wallItems: [],
    spots,
    doors: [],
    theme: { floor: 'stone', hue: 40, accent: '#c8a45a', carpet: '#46556e', carpetAlt: '#3a4760', pattern: 1, wood: 0 },
  };
}
