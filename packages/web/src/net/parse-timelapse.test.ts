import { describe, expect, test } from 'vitest';
import { createDemoSimulator, dayRange, demoTimelapse } from '@ai-office/shared';
import { parseTimelapse } from './parse-timelapse';

const NOW = new Date(2026, 9, 21, 15, 30).getTime();
const range = dayRange('2026-10-20');
if (range === undefined) throw new Error('no range');
const demo = demoTimelapse({
  range,
  now: NOW,
  locale: 'en',
  agents: createDemoSimulator({ seed: 3, now: () => NOW }).agents(),
  account: 'all',
});
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const base = {
  date: '2026-10-20',
  generatedAt: 5,
  account: 'all',
  start: 0,
  end: 100,
  projects: [{ id: '/p', name: 'p', order: 0, seed: 1 }],
  agents: [
    { id: 'a:s', kind: 'main', name: 'Ana', role: 'Principal', accountId: 'a', projectId: '/p', look: 'f', seed: 3 },
  ],
};

describe('parseTimelapse', () => {
  test('reads what the server sends, whole: a demo day survives the trip unchanged', () => {
    expect(parseTimelapse(wire(demo))).toEqual(demo);
  });

  test('drops events it cannot read and keeps the rest', () => {
    const parsed = parseTimelapse({
      ...base,
      events: [
        { at: 1, type: 'arrive', agent: 0 },
        { at: 2, type: 'arrive', agent: 5 },
        { at: 3, type: 'status', agent: 0, status: 'sleeping' },
        { at: 'x', type: 'leave', agent: 0 },
        { at: 4, type: 'warp', agent: 0 },
        {
          at: 5,
          type: 'activity',
          agent: 0,
          kind: 'read',
          icon: '📖',
          text: 'Lendo',
          msg: { key: 'activity.read', params: { file: 'a', nested: { key: 'k' }, bad: [1] } },
        },
        { at: 6, type: 'activity', agent: 0, kind: 'read', icon: '📖', text: 'Lendo' },
        { at: 7, type: 'commit', project: 3, hash: 'x', subject: 's' },
        { at: 8, type: 'commit', project: 0, hash: 'abc', subject: 's' },
        'nope',
        null,
        { at: 9, type: 'test', agent: 0, runner: 'vitest', outcome: 'failed', failed: 2 },
        {
          at: 10,
          type: 'tasks',
          agent: 0,
          tasks: [
            { title: 'A', status: 'done' },
            { title: 'B', status: 'pending' },
          ],
        },
      ],
    });

    expect(parsed.events).toEqual([
      { at: 1, type: 'arrive', agent: 0 },
      {
        at: 5,
        type: 'activity',
        agent: 0,
        kind: 'read',
        icon: '📖',
        text: 'Lendo',
        msg: { key: 'activity.read', params: { file: 'a', nested: { key: 'k' } } },
      },
      { at: 8, type: 'commit', project: 0, hash: 'abc', subject: 's' },
      { at: 9, type: 'test', agent: 0, runner: 'vitest', outcome: 'failed', failed: 2 },
      { at: 10, type: 'tasks', agent: 0, tasks: [{ title: 'B', status: 'pending' }] },
    ]);
  });

  test('puts events in order when the server did not', () => {
    const parsed = parseTimelapse({
      ...base,
      events: [
        { at: 9, type: 'leave', agent: 0 },
        { at: 3, type: 'arrive', agent: 0 },
      ],
    });

    expect(parsed.events.map((event) => event.at)).toEqual([3, 9]);
  });

  test('refuses a list of agents or rooms with an unreadable entry: events point at them by position', () => {
    expect(() => parseTimelapse({ ...base, agents: [...base.agents, { id: 7 }], events: [] })).toThrow();
    expect(() => parseTimelapse({ ...base, projects: [{ nope: true }], events: [] })).toThrow();
  });

  test('refuses anything that is not a time-lapse', () => {
    for (const data of [null, 'x', [], {}, { date: 3 }]) expect(() => parseTimelapse(data)).toThrow();
  });

  test('keeps the range only when it makes sense, and the flags', () => {
    expect(
      parseTimelapse({ ...base, events: [], from: 10, to: 20, truncated: true, trimmed: true, demo: true }),
    ).toMatchObject({ from: 10, to: 20, truncated: true, trimmed: true, demo: true });
    expect(parseTimelapse({ ...base, events: [], from: 30, to: 20 }).from).toBeUndefined();
    expect(parseTimelapse({ ...base, events: [], from: 10 }).to).toBeUndefined();
  });

  test('cuts long texts', () => {
    const parsed = parseTimelapse({
      ...base,
      events: [
        { at: 1, type: 'activity', agent: 0, kind: 'read', icon: '📖', text: 'x'.repeat(5000), msg: { key: 'k' } },
      ],
    });
    const event = parsed.events[0];

    expect(event?.type === 'activity' ? event.text.length : 0).toBe(400);
  });
});
