import { describe, expect, test } from 'vitest';
import { makeAgent, makeSnapshot } from '../../sim/testkit';
import type { Marker } from '../../timelapse/markers';
import { axisTicks, fractionAt, liveAttention, markerStep, percentOf, pixelsToMs } from './replay';

const at = (hour: number, minute = 0): number => new Date(2026, 9, 21, hour, minute).getTime();
const marker = (time: number): Marker => ({ at: time, kind: 'commit', project: 'loja', count: 1 });

describe('position on the scrubber', () => {
  test('percent of the span, clamped; an empty span is the end', () => {
    expect(percentOf(at(12), at(8), at(16))).toBe(50);
    expect(percentOf(at(7), at(8), at(16))).toBe(0);
    expect(percentOf(at(20), at(8), at(16))).toBe(100);
    expect(percentOf(at(8), at(8), at(8))).toBe(100);
  });

  test('fraction under the pointer, clamped to the scrubber', () => {
    expect(fractionAt(150, 100, 200)).toBe(0.25);
    expect(fractionAt(50, 100, 200)).toBe(0);
    expect(fractionAt(500, 100, 200)).toBe(1);
    expect(fractionAt(150, 100, 0)).toBe(0);
  });

  test('pixels to replay time', () => {
    expect(pixelsToMs(10, 1000, at(8), at(18))).toBe(360_000);
    expect(pixelsToMs(10, 0, at(8), at(18))).toBe(0);
  });
});

describe('axisTicks', () => {
  test('every other round hour for a working day', () => {
    expect(axisTicks(at(8, 20), at(17, 40))).toEqual([at(10), at(12), at(14), at(16)]);
  });

  test('finer for a short span', () => {
    expect(axisTicks(at(9, 5), at(10, 40))).toEqual([at(9, 15), at(9, 30), at(9, 45), at(10), at(10, 15), at(10, 30)]);
  });

  test('coarser for a long span and never more than seven labels', () => {
    for (const [from, to] of [
      [at(0), at(23, 59)],
      [at(1), at(20)],
      [at(9), at(9, 20)],
    ] as const)
      expect(axisTicks(from, to).length).toBeLessThanOrEqual(7);
  });

  test('nothing for an empty span', () => {
    expect(axisTicks(at(9), at(9))).toEqual([]);
    expect(axisTicks(at(9), at(8))).toEqual([]);
  });
});

describe('markerStep', () => {
  const markers = [marker(at(9)), marker(at(11)), marker(at(14))];

  test('goes to the next or previous mark, skipping the one the clock is on', () => {
    expect(markerStep(markers, at(10), 1)?.at).toBe(at(11));
    expect(markerStep(markers, at(11), 1)?.at).toBe(at(14));
    expect(markerStep(markers, at(11), -1)?.at).toBe(at(9));
    expect(markerStep(markers, at(10), -1)?.at).toBe(at(9));
  });

  test('stops at the ends', () => {
    expect(markerStep(markers, at(14), 1)).toBeUndefined();
    expect(markerStep(markers, at(9), -1)).toBeUndefined();
    expect(markerStep([], at(9), 1)).toBeUndefined();
  });
});

describe('liveAttention', () => {
  test('counts the people of the live office who are waiting for the user', () => {
    const snapshot = makeSnapshot(1, [
      makeAgent('ana', 0, 'waiting'),
      makeAgent('bia', 0, 'working'),
      makeAgent('caio', 0, 'waiting'),
    ]);

    expect(liveAttention(snapshot)).toBe(2);
    expect(liveAttention(null)).toBe(0);
  });
});
