import { describe, expect, test } from 'vitest';
import { bulbPositions, plaqueName, plaqueText, PLAQUE_PLATE } from './furnDecor';
import { textWidth } from '../font';

describe('plaqueName', () => {
  test('keeps a short name as it is, in the capitals of the font', () => {
    expect(plaqueName('Ana')).toBe('ANA');
  });

  test('folds accents the 3x5 font cannot draw', () => {
    expect(plaqueName('Heloísa')).toBe('HELOISA');
  });

  test('cuts a long name with a full stop so it stays inside the plate', () => {
    const name = plaqueName('Guilherme');

    expect(name).toBe('GUILHE.');
    expect(textWidth(name)).toBeLessThanOrEqual(PLAQUE_PLATE.w - 4);
  });

  test('drops what the font has no glyph for', () => {
    expect(plaqueName('A@B#C')).toBe('ABC');
  });
});

describe('plaqueText', () => {
  test('puts a star on each side of a short name', () => {
    expect(plaqueText('Ana')).toBe('*ANA*');
  });

  test('leaves the stars out when the name needs the room', () => {
    expect(plaqueText('Heloísa')).toBe('HELOISA');
  });

  test('always fits the plate', () => {
    for (const name of ['Ana', 'Bia', 'Theo', 'Priscila', 'Heloísa', 'Guilherme', 'Maria Eduarda'])
      expect(textWidth(plaqueText(name)), name).toBeLessThanOrEqual(PLAQUE_PLATE.w - 4);
  });
});

describe('bulbPositions', () => {
  test('hangs a bulb every few pixels along the garland, lower in the middle than at the ends', () => {
    const bulbs = bulbPositions(128, 0);

    expect(bulbs.length).toBe(16);
    const ends = Math.max(bulbs[0].y, bulbs[bulbs.length - 1].y);
    const middle = bulbs[Math.floor(bulbs.length / 2)].y;
    expect(middle).toBeGreaterThan(ends);
  });

  test('keeps every bulb inside the segment', () => {
    for (const bulb of bulbPositions(64, 2)) {
      expect(bulb.x).toBeGreaterThan(0);
      expect(bulb.x).toBeLessThan(64);
    }
  });

  test('different segments start their colours at different places', () => {
    expect(bulbPositions(64, 0)[0].color).not.toBe(bulbPositions(64, 1)[0].color);
  });
});
