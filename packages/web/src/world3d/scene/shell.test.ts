import { describe, expect, it } from 'vitest';
import { computeBuilding } from '../../layout/building';
import { ledgeGaps, northGaps, solidRanges, westGaps, type Gap } from './shell';
import { TILE_M } from '../units';

const gap = (a: number, b: number): Gap => ({ a, b, kind: 'door' });

describe('solidRanges', () => {
  it('returns the whole span when there are no gaps', () => {
    expect(solidRanges(0, 10, [])).toEqual([[0, 10]]);
  });

  it('cuts the span around gaps in any order', () => {
    expect(solidRanges(0, 10, [gap(6, 7), gap(2, 3)])).toEqual([
      [0, 2],
      [3, 6],
      [7, 10],
    ]);
  });

  it('drops empty pieces at the edges and merges overlapping gaps', () => {
    expect(solidRanges(0, 10, [gap(0, 2), gap(1.5, 4), gap(9, 10)])).toEqual([[4, 9]]);
  });
});

describe('wall openings from the layout', () => {
  const building = computeBuilding([
    { id: 'p1', seed: 7, name: 'p1', slot: 0 },
    { id: 'p2', seed: 9, name: 'p2', slot: 1 },
  ]);
  const reception = building.areas.find((a) => a.id === 'reception')!;

  it('opens the reception wall for both elevators', () => {
    const gaps = northGaps(reception);
    expect(gaps.filter((g) => g.kind === 'elevator')).toHaveLength(2);
    expect(gaps[0].b - gaps[0].a).toBeCloseTo(2 * TILE_M);
  });

  it('opens west glass doors only where the layout has them', () => {
    expect(westGaps(reception)).toHaveLength(1);
    expect(westGaps(building.areas.find((a) => a.id === 'copa')!)).toHaveLength(0);
  });

  it('gives every north-row room a door gap in its corridor partition and every south-row room one in its back wall', () => {
    for (const area of building.areas) {
      if (area.row === 'north') expect(ledgeGaps(area).length).toBe(area.doors.length);
      if (area.row === 'south') expect(northGaps(area).filter((g) => g.kind === 'door').length).toBe(area.doors.length);
    }
  });
});
