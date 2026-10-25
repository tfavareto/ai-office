import { describe, expect, test } from 'vitest';
import { useTimeZone } from '../usage/test-zone';
import { demoProgress } from './demo';
import { decorForLevel } from './levels';

useTimeZone('America/Sao_Paulo');

const NOW = new Date(2026, 9, 21, 15, 0).getTime();

describe('demoProgress', () => {
  test('is a level six office with many badges and an employee of the month', () => {
    const { progress, summary } = demoProgress({ now: NOW, agentNames: ['Ana', 'Bruno'] });

    expect(summary.level).toBe(6);
    expect(progress.level.level).toBe(6);
    expect(summary.achievements).toBeGreaterThanOrEqual(12);
    expect(summary.employee).toBe('Ana');
    expect(progress.demo).toBe(true);
    expect(decorForLevel(summary.level).has('pet')).toBe(true);
  });

  test('is deterministic', () => {
    expect(demoProgress({ now: NOW })).toEqual(demoProgress({ now: NOW }));
  });

  test('can pin the level to preview the decoration', () => {
    expect(demoProgress({ now: NOW, level: 10 }).summary.level).toBe(10);
    expect(demoProgress({ now: NOW, level: 3 }).summary.level).toBe(3);
  });
});
