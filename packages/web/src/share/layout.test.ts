import { describe, expect, it } from 'vitest';
import { HERO_SCALE, cardLayout, fitFont, heroPixels, tileGrid, wrapText, type Rect } from './layout';
import { CARD_SIZES, type CardFormat } from './types';

const FORMATS: CardFormat[] = ['landscape', 'square'];
const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x - 1e-6 &&
  inner.y >= outer.y - 1e-6 &&
  inner.x + inner.w <= outer.x + outer.w + 1e-6 &&
  inner.y + inner.h <= outer.y + outer.h + 1e-6;
const overlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
/** Width of a text with 10 px per character at 10 px (so `px` per character at `px`). */
const measureFont = (text: string) => (px: number) => text.length * px;
const measureText = (text: string): number => text.length * 10;

describe('cardLayout', () => {
  it('has the size of the format', () => {
    expect(cardLayout('landscape', 5)).toMatchObject({ width: 1200, height: 630 });
    expect(cardLayout('square', 5)).toMatchObject({ width: 1080, height: 1080 });
  });

  it.each(FORMATS.flatMap((format) => [2, 3, 5, 7].map((count) => [format, count] as const)))(
    'keeps every block of %s with %i numbers inside the card and apart from the others',
    (format, count) => {
      // Arrange
      const layout = cardLayout(format, count);
      const card: Rect = { x: 0, y: 0, w: layout.width, h: layout.height };
      const blocks = [layout.header, layout.hero, layout.statsPanel, layout.highlight, layout.footer];

      // Assert
      for (const block of blocks) expect(inside(block, card)).toBe(true);
      for (const [i, a] of blocks.entries())
        for (const b of blocks.slice(i + 1)) expect(overlap(a, b), `${i}`).toBe(false);
      for (const tile of layout.tiles) expect(inside(tile, layout.statsPanel)).toBe(true);
      expect(layout.tiles).toHaveLength(count);
    },
  );

  it('gives the picture a landscape box wide enough for the building', () => {
    const { hero } = cardLayout('landscape', 5);

    expect(hero.w).toBe(1120);
    expect(hero.w / hero.h).toBeGreaterThan(2.5);
    expect(hero.w / hero.h).toBeLessThan(4);
  });

  it('lays the square card out in two rows when there are more than three numbers', () => {
    const rows = new Set(cardLayout('square', 5).tiles.map((tile) => tile.y));

    expect(rows.size).toBe(2);
  });

  it('lays the landscape card out in one row of equal tiles', () => {
    const tiles = cardLayout('landscape', 6).tiles;

    expect(new Set(tiles.map((tile) => tile.y)).size).toBe(1);
    expect(new Set(tiles.map((tile) => Math.round(tile.w))).size).toBe(1);
  });

  it('asks for the picture at twice the size it is drawn at', () => {
    const layout = cardLayout('landscape', 5);

    expect(heroPixels(layout)).toEqual({ width: layout.hero.w * HERO_SCALE, height: layout.hero.h * HERO_SCALE });
  });

  it('stays inside the size table', () => {
    for (const format of FORMATS) expect(cardLayout(format, 4).width).toBe(CARD_SIZES[format].width);
  });
});

describe('tileGrid', () => {
  const area: Rect = { x: 10, y: 20, w: 300, h: 100 };

  it('splits the width equally with the gap between tiles', () => {
    const tiles = tileGrid(area, 3, 3, 15);

    expect(tiles.map((t) => t.w)).toEqual([90, 90, 90]);
    expect(tiles.map((t) => t.x)).toEqual([10, 115, 220]);
  });

  it('centres a last row that is not full', () => {
    const tiles = tileGrid(area, 5, 3, 10);
    const last = tiles.slice(3);

    expect(last).toHaveLength(2);
    const left = (last[0] as Rect).x - area.x;
    const right = area.x + area.w - ((last[1] as Rect).x + (last[1] as Rect).w);
    expect(left).toBeCloseTo(right, 6);
  });

  it('returns nothing for no tiles', () => {
    expect(tileGrid(area, 0, 3, 10)).toEqual([]);
  });
});

describe('fitFont', () => {
  it('picks the largest size that fits', () => {
    expect(fitFont(measureFont('1234'), 100, 60, 10)).toBe(25);
  });

  it('keeps the maximum when the text already fits', () => {
    expect(fitFont(measureFont('12'), 500, 40, 10)).toBe(40);
  });

  it('never goes below the minimum', () => {
    expect(fitFont(measureFont('123456789'), 20, 40, 12)).toBe(12);
  });
});

describe('wrapText', () => {
  it('keeps a short sentence on one line', () => {
    expect(wrapText(measureText, 'one two three', 200, 2)).toEqual(['one two three']);
  });

  it('breaks between words', () => {
    expect(wrapText(measureText, 'alpha beta gamma delta', 100, 3)).toEqual(['alpha beta', 'gamma', 'delta']);
  });

  it('ends the last line with an ellipsis when the text does not fit', () => {
    const lines = wrapText(measureText, 'alpha beta gamma delta epsilon', 100, 2);

    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith('…')).toBe(true);
    expect(measureText(lines[1] ?? '')).toBeLessThanOrEqual(100);
  });

  it('cuts a single word that is wider than the line', () => {
    const lines = wrapText(measureText, 'supercalifragilistic', 80, 1);

    expect(lines).toHaveLength(1);
    expect(measureText(lines[0] ?? '')).toBeLessThanOrEqual(80);
  });

  it('returns no line for an empty text', () => {
    expect(wrapText(measureText, '   ', 100, 2)).toEqual([]);
  });
});
