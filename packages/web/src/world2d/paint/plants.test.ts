import { describe, expect, it } from 'vitest';
import type { FurnitureItem, FurnitureKind } from '../../layout/types';
import { TILE } from '../../layout/constants';
import { spriteRise } from './furniture';
import { PLANT_BASE, PLANT_CX, plant, plantTall } from './plants';

/** A context that records every painted pixel (fillRect only, which is all the painters use). */
function pixelRecorder(): { ctx: CanvasRenderingContext2D; pixels: Set<string> } {
  const pixels = new Set<string>();
  const ctx = {
    fillStyle: '',
    fillRect: (x: number, y: number, w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) pixels.add(`${px},${py}`);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, pixels };
}

function item(kind: FurnitureKind, variant: number): FurnitureItem {
  return { id: 'p', kind, x: 0, y: 0, w: 1, h: 1, variant, facing: 'n', rotation: 0, blocks: [], tall: false };
}

function paint(kind: 'plant' | 'plantTall', variant: number): Set<string> {
  const { ctx, pixels } = pixelRecorder();
  (kind === 'plant' ? plant : plantTall)(ctx, item(kind, variant));
  return pixels;
}

function components(pixels: Set<string>): number {
  const seen = new Set<string>();
  let count = 0;
  for (const start of pixels) {
    if (seen.has(start)) continue;
    count++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const [x, y] = stack.pop()!.split(',').map(Number);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = `${x + dx},${y + dy}`;
          if (pixels.has(key) && !seen.has(key)) {
            seen.add(key);
            stack.push(key);
          }
        }
      }
    }
  }
  return count;
}

const CASES = [...[0, 1, 2, 3].map((v) => ['plant', v] as const), ...[0, 1].map((v) => ['plantTall', v] as const)];

describe('indoor plants', () => {
  it.each(CASES)('%s variant %i stays inside its tile and the sprite rise', (kind, variant) => {
    const pixels = paint(kind, variant);
    const rise = spriteRise(kind);
    for (const key of pixels) {
      const [x, y] = key.split(',').map(Number);
      expect(x, key).toBeGreaterThanOrEqual(0);
      expect(x, key).toBeLessThan(TILE);
      expect(y, key).toBeGreaterThanOrEqual(-rise);
      expect(y, key).toBeLessThanOrEqual(PLANT_BASE);
    }
  });

  it.each(CASES)('%s variant %i is one connected piece standing on the shared baseline', (kind, variant) => {
    const pixels = paint(kind, variant);
    expect(pixels.has(`${PLANT_CX},${PLANT_BASE}`)).toBe(true);
    expect(components(pixels)).toBe(1);
  });

  it.each(CASES)('%s variant %i has its pot centred under the foliage', (kind, variant) => {
    const pixels = paint(kind, variant);
    const xs = [...pixels].filter((k) => k.endsWith(`,${PLANT_BASE}`)).map((k) => Number(k.split(',')[0]));
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs) + Math.max(...xs)).toBe(PLANT_CX * 2);
  });
});
