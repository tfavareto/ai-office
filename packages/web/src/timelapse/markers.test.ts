import { describe, expect, test } from 'vitest';
import { type Timelapse, type TimelapseEvent } from '@ai-office/shared';
import { buildMarkers, markerNear, type Marker } from './markers';

const MIN = 60_000;
const T = 1_000_000_000;

function day(events: TimelapseEvent[]): Timelapse {
  return {
    date: '2026-10-21',
    generatedAt: T,
    account: 'all',
    start: T - 1000,
    end: T + 1e9,
    projects: [{ id: '/work/loja', name: 'loja', order: 0, seed: 1 }],
    agents: [
      {
        id: 'a:s1',
        kind: 'main',
        name: 'Ana',
        role: 'Principal',
        accountId: 'a',
        projectId: '/work/loja',
        look: 'f',
        seed: 1,
      },
      {
        id: 'a:s1:x',
        kind: 'sub',
        parentId: 'a:s1',
        name: 'Bruno',
        role: 'Explore',
        accountId: 'a',
        projectId: '/work/loja',
        look: 'm',
        seed: 2,
      },
    ],
    events,
  };
}

describe('buildMarkers', () => {
  test('marks commits, failed tests, waits and the arrival of people (not of subagents), but not passing tests', () => {
    const markers = buildMarkers(
      day([
        { at: T, type: 'arrive', agent: 0 },
        { at: T + 10 * MIN, type: 'arrive', agent: 1 },
        { at: T + 20 * MIN, type: 'test', agent: 0, runner: 'vitest', outcome: 'passed', passed: 3 },
        { at: T + 30 * MIN, type: 'test', agent: 0, runner: 'vitest', outcome: 'failed', passed: 2, failed: 1 },
        { at: T + 40 * MIN, type: 'permission', agent: 0, tool: 'Edit', durationMs: 2 * MIN },
        { at: T + 50 * MIN, type: 'commit', project: 0, agent: 0, hash: 'abc1234', subject: 'feat: x' },
      ]),
      1000,
    );

    expect(markers).toEqual([
      { at: T, kind: 'arrival', agent: 'Ana', project: 'loja', count: 1 },
      { at: T + 30 * MIN, kind: 'test-failed', agent: 'Ana', project: 'loja', detail: 'vitest', count: 1 },
      { at: T + 40 * MIN, kind: 'wait', agent: 'Ana', project: 'loja', detail: 'Edit', durationMs: 2 * MIN, count: 1 },
      { at: T + 50 * MIN, kind: 'commit', agent: 'Ana', project: 'loja', detail: 'feat: x', count: 1 },
    ]);
  });

  test('a commit Git saw alone has no author', () => {
    const [marker] = buildMarkers(day([{ at: T, type: 'commit', project: 0, hash: 'f', subject: 'by hand' }]), 1000);

    expect(marker?.agent).toBeUndefined();
    expect(marker).toMatchObject({ kind: 'commit', project: 'loja', detail: 'by hand' });
  });

  test('merges marks of the same kind that are too close to tell apart, keeping the first and counting them', () => {
    const commits: TimelapseEvent[] = [0, 1, 2].map((i) => ({
      at: T + i * 1000,
      type: 'commit',
      project: 0,
      agent: 0,
      hash: `h${i}`,
      subject: `s${i}`,
    }));
    const markers = buildMarkers(
      day([
        ...commits,
        { at: T + 500, type: 'permission', agent: 0, tool: 'Bash', durationMs: 20_000 },
        { at: T + 5 * MIN, type: 'commit', project: 0, agent: 0, hash: 'z', subject: 'far' },
      ]),
      5000,
    );

    expect(markers.filter((marker) => marker.kind === 'commit').map((marker) => [marker.detail, marker.count])).toEqual(
      [
        ['s0', 3],
        ['far', 1],
      ],
    );
    expect(markers.filter((marker) => marker.kind === 'wait')).toHaveLength(1);
  });

  test('an empty day has no marks', () => {
    expect(buildMarkers(day([]), 1000)).toEqual([]);
  });
});

describe('markerNear', () => {
  const marker = (at: number, kind: Marker['kind']): Marker => ({ at, kind, project: 'loja', count: 1 });
  const markers = [marker(T, 'arrival'), marker(T + 10_000, 'commit'), marker(T + 20_000, 'test-failed')];

  test('finds the closest mark within the tolerance, or none', () => {
    expect(markerNear(markers, T + 12_000, 5000)?.kind).toBe('commit');
    expect(markerNear(markers, T + 17_000, 5000)?.kind).toBe('test-failed');
    expect(markerNear(markers, T + 5000 + 1, 4000)).toBeUndefined();
    expect(markerNear([], T, 5000)).toBeUndefined();
  });

  test('on a tie the more important mark wins', () => {
    const tie = [marker(T, 'arrival'), marker(T + 10_000, 'test-failed')];

    expect(markerNear(tie, T + 5000, 6000)?.kind).toBe('test-failed');
  });
});
