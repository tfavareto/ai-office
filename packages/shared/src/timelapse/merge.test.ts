import { describe, expect, test } from 'vitest';
import { mergeTimelapses } from './merge';
import { compareEvents, sortEvents } from './order';
import { type Timelapse, type TimelapseAgent, type TimelapseEvent, emptyTimelapse } from './types';

const base = { date: '2026-10-21', generatedAt: 5, account: 'all', start: 0, end: 1000 };
const agent = (id: string, projectId: string): TimelapseAgent => ({ id, kind: 'main', name: id, role: 'Principal', accountId: 'a', projectId, look: 'f', seed: 1 });
const timelapse = (id: string, project: string, at: number, extra: Partial<Timelapse> = {}): Timelapse => ({
  ...base,
  from: at,
  to: at + 100,
  projects: [{ id: project, name: project, order: 0, seed: 1 }],
  agents: [agent(id, project)],
  events: [
    { at, type: 'arrive', agent: 0 },
    { at: at + 50, type: 'commit', project: 0, agent: 0, hash: 'abc1234', subject: 's' },
  ],
  ...extra,
});

describe('mergeTimelapses', () => {
  test('puts the second after the first and renumbers its agents and projects', () => {
    const merged = mergeTimelapses(timelapse('a', '/a', 10), timelapse('b', '/b', 5, { demo: true }));

    expect(merged.agents.map((candidate) => candidate.id)).toEqual(['a', 'b']);
    expect(merged.projects.map((project) => [project.id, project.order])).toEqual([['/a', 0], ['/b', 1]]);
    expect(merged.events).toEqual([
      { at: 5, type: 'arrive', agent: 1 },
      { at: 10, type: 'arrive', agent: 0 },
      { at: 55, type: 'commit', project: 1, agent: 1, hash: 'abc1234', subject: 's' },
      { at: 60, type: 'commit', project: 0, agent: 0, hash: 'abc1234', subject: 's' },
    ]);
    expect([merged.from, merged.to, merged.demo]).toEqual([5, 110, true]);
  });

  test('keeps a commit that no agent made without an agent', () => {
    const lone: Timelapse = { ...timelapse('b', '/b', 5), events: [{ at: 7, type: 'commit', project: 0, hash: 'f', subject: 's' }] };
    const merged = mergeTimelapses(timelapse('a', '/a', 10), lone);

    expect(merged.events.find((event) => event.type === 'commit' && event.hash === 'f')).toEqual({ at: 7, type: 'commit', project: 1, hash: 'f', subject: 's' });
  });

  test('an empty side leaves the other one as it is', () => {
    const real = timelapse('a', '/a', 10);
    const empty = emptyTimelapse(base);

    expect(mergeTimelapses(real, empty)).toBe(real);
    expect(mergeTimelapses(empty, { ...real, demo: true })).toMatchObject({ agents: real.agents, demo: true });
    expect(mergeTimelapses(emptyTimelapse(base), emptyTimelapse(base)).events).toEqual([]);
  });

  test('keeps the truncation flag of the real side', () => {
    expect(mergeTimelapses(timelapse('a', '/a', 10, { truncated: true }), timelapse('b', '/b', 5)).truncated).toBe(true);
  });
});

describe('event order', () => {
  const at = 100;
  const events: TimelapseEvent[] = [
    { at, type: 'leave', agent: 0 },
    { at, type: 'activity', agent: 0, kind: 'read', icon: 'x', text: 't', msg: { key: 'k' } },
    { at, type: 'status', agent: 0, status: 'working' },
    { at, type: 'arrive', agent: 0 },
    { at: at - 1, type: 'leave', agent: 1 },
  ];

  test('goes by time, then by what a person does first: arrive, status, things, leave', () => {
    expect(sortEvents(events).map((event) => event.type)).toEqual(['leave', 'arrive', 'status', 'activity', 'leave']);
    expect(events[0]?.at).toBe(at);
  });

  test('is stable for events of the same kind at the same time', () => {
    const first: TimelapseEvent = { at, type: 'status', agent: 0, status: 'working' };
    const second: TimelapseEvent = { at, type: 'status', agent: 1, status: 'idle' };

    expect(compareEvents(first, second)).toBe(0);
    expect(sortEvents([first, second])).toEqual([first, second]);
  });
});
