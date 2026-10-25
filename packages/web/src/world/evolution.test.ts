import { describe, expect, test } from 'vitest';
import type { ProgressSummary } from '@ai-office/shared';
import { BASE_EVOLUTION, cupsFor, evolutionKey, evolutionOf, MAX_CUPS } from './evolution';

const summary = (over: Partial<ProgressSummary> = {}): ProgressSummary => ({
  level: 6,
  xp: 5200,
  from: 5000,
  to: 9000,
  achievements: 11,
  total: 22,
  recent: [],
  employee: 'Ana',
  ...over,
});

describe('evolutionOf', () => {
  test('is the plain office without progress or when the setting is off', () => {
    expect(evolutionOf(undefined, true)).toBe(BASE_EVOLUTION);
    expect(evolutionOf(summary(), false)).toBe(BASE_EVOLUTION);
  });

  test('a level six office has the pet and the aquarium but not the arcade yet', () => {
    const evolution = evolutionOf(summary(), true);

    expect(evolution.decor.has('pet')).toBe(true);
    expect(evolution.decor.has('aquarium')).toBe(true);
    expect(evolution.decor.has('arcade')).toBe(false);
    expect(evolution.employee).toBe('Ana');
  });

  test('has no employee when nobody finished a task', () => {
    expect(evolutionOf(summary({ employee: undefined }), true).employee).toBeNull();
  });

  test('clamps a level that is out of range', () => {
    expect(evolutionOf(summary({ level: 99 }), true).level).toBe(10);
    expect(evolutionOf(summary({ level: -3 }), true).level).toBe(1);
  });
});

describe('cupsFor', () => {
  test('is empty with no achievements and grows by one cup per two achievements', () => {
    expect(cupsFor(0)).toEqual([]);
    expect(cupsFor(1)).toEqual(['bronze']);
    expect(cupsFor(2)).toEqual(['bronze']);
    expect(cupsFor(3)).toHaveLength(2);
  });

  test('gets shinier and stops at the shelf size', () => {
    const cups = cupsFor(22);

    expect(cups).toHaveLength(MAX_CUPS);
    expect(cups[0]).toBe('bronze');
    expect(cups[MAX_CUPS - 1]).toBe('gold');
  });
});

describe('evolutionKey', () => {
  test('changes with the decoration, the employee and the cups, and nothing else', () => {
    const a = evolutionKey(evolutionOf(summary(), true));

    expect(evolutionKey(evolutionOf(summary({ xp: 5300 }), true))).toBe(a);
    expect(evolutionKey(evolutionOf(summary({ employee: 'Bia' }), true))).not.toBe(a);
    expect(evolutionKey(evolutionOf(summary({ level: 7 }), true))).not.toBe(a);
    expect(evolutionKey(evolutionOf(summary({ achievements: 20 }), true))).not.toBe(a);
  });
});
