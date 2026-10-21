import { describe, expect, test } from 'vitest';
import { type Account, type OfficeMeta, type Timelapse, type TimelapseEvent, createDemoSimulator, dayRange, demoTimelapse } from '@ai-office/shared';
import { buildReplay, countUpTo, feedAt, presentCount, snapshotAt, type ReplayIndex } from './replay';

const MIN = 60_000;
const SEC = 1000;
const T = 1_000_000_000;
const META: OfficeMeta = { version: 'x', startedAt: 0, local: true, demo: false };
const ACCOUNTS: Account[] = [{ id: 'a', label: 'A', initial: 'A', color: '#fff', dir: '/a' }];
const context = (rev = 1) => ({ accounts: ACCOUNTS, meta: META, rev });

function story(): Timelapse {
  const events: TimelapseEvent[] = [
    { at: T, type: 'arrive', agent: 0 },
    { at: T, type: 'status', agent: 0, status: 'idle' },
    { at: T + 10 * SEC, type: 'status', agent: 0, status: 'working' },
    { at: T + 10 * SEC, type: 'activity', agent: 0, kind: 'prompt', icon: '📨', text: 'Nova tarefa', msg: { key: 'timelapse.activity.prompt' } },
    { at: T + 12 * SEC, type: 'tasks', agent: 0, tasks: [{ title: 'Escrever', status: 'in_progress' }, { title: 'Publicar', status: 'pending' }] },
    { at: T + 20 * SEC, type: 'activity', agent: 0, kind: 'read', icon: '📖', text: 'Lendo a.ts', msg: { key: 'activity.read', params: { file: 'a.ts' } } },
    { at: T + 30 * SEC, type: 'activity', agent: 0, kind: 'subagent', icon: '👥', text: 'Delegando', msg: { key: 'activity.subagent' } },
    { at: T + 33 * SEC, type: 'arrive', agent: 1 },
    { at: T + 33 * SEC, type: 'status', agent: 1, status: 'working' },
    { at: T + 40 * SEC, type: 'shell', agent: 0, on: true, id: 'b1', background: false, label: 'npm test' },
    { at: T + 50 * SEC, type: 'status', agent: 0, status: 'waiting', waitingFor: 'Aprovar Edit', waitingForMsg: { key: 'waiting.approve', params: { tool: 'Edit' } } },
    { at: T + 50 * SEC, type: 'permission', agent: 0, tool: 'Edit', durationMs: 20 * SEC },
    { at: T + 60 * SEC, type: 'leave', agent: 1 },
    { at: T + 70 * SEC, type: 'status', agent: 0, status: 'working' },
    { at: T + 80 * SEC, type: 'shell', agent: 0, on: false, id: 'b1', background: false },
    { at: T + 90 * SEC, type: 'tasks', agent: 0, tasks: [{ title: 'Escrever', status: 'completed' }, { title: 'Publicar', status: 'in_progress' }] },
    { at: T + 100 * SEC, type: 'status', agent: 0, status: 'idle' },
    { at: T + 5 * MIN, type: 'leave', agent: 0 },
    { at: T + 6 * MIN, type: 'arrive', agent: 0 },
    { at: T + 6 * MIN, type: 'status', agent: 0, status: 'working' },
    { at: T + 7 * MIN, type: 'arrive', agent: 2 },
    { at: T + 7 * MIN, type: 'status', agent: 2, status: 'idle' },
  ];
  return {
    date: '2026-10-21',
    generatedAt: T,
    account: 'all',
    start: T - 1000,
    end: T + 24 * 3_600_000,
    from: T,
    to: T + 8 * MIN,
    projects: [
      { id: '/work/loja', name: 'loja', order: 0, seed: 1 },
      { id: '/work/api', name: 'api', order: 1, seed: 2 },
    ],
    agents: [
      { id: 'a:s1', kind: 'main', name: 'Ana', role: 'Principal', roleMsg: { key: 'agent.role.main' }, accountId: 'a', projectId: '/work/loja', look: 'f', seed: 11 },
      { id: 'a:s1:x', kind: 'sub', parentId: 'a:s1', name: 'Bruno', role: 'Explore', title: 'Explorar', accountId: 'a', projectId: '/work/loja', look: 'm', seed: 12 },
      { id: 'a:s2', kind: 'main', name: 'Carla', role: 'Principal', accountId: 'a', projectId: '/work/api', look: 'f', seed: 13 },
    ],
    events,
  };
}

const index = (): ReplayIndex => buildReplay(story());
const at = (offset: number) => snapshotAt(index(), T + offset, context());
const agent = (offset: number, id: string) => at(offset).agents.find((candidate) => candidate.id === id);

describe('who is in the office', () => {
  test('nobody before the first arrival, then people as they arrive and leave', () => {
    expect(at(-1).agents).toEqual([]);
    expect(at(0).agents.map((a) => a.id)).toEqual(['a:s1']);
    expect(at(40 * SEC).agents.map((a) => a.id)).toEqual(['a:s1', 'a:s1:x']);
    expect(at(60 * SEC).agents.map((a) => a.id)).toEqual(['a:s1']);
    expect(at(5 * MIN + SEC).agents).toEqual([]);
    expect(at(7 * MIN + SEC).agents.map((a) => a.id)).toEqual(['a:s1', 'a:s2']);
  });

  test('a person who left and came back is a new stay, with fresh times', () => {
    const back = agent(6 * MIN + 10 * SEC, 'a:s1');

    expect(back).toMatchObject({ startedAt: T + 6 * MIN, status: 'working', statusSince: T + 6 * MIN });
    expect(back?.recent).toEqual([]);
    expect(back?.activity).toBeUndefined();
  });

  test('rooms exist while somebody works in them, with the order they were first opened in', () => {
    expect(at(-1).projects).toEqual([]);
    expect(at(10 * SEC).projects).toMatchObject([{ id: '/work/loja', name: 'loja', path: '/work/loja', order: 0, seed: 1 }]);
    expect(at(5 * MIN + SEC).projects).toEqual([]);
    expect(at(7 * MIN + SEC).projects.map((p) => [p.id, p.order])).toEqual([['/work/loja', 0], ['/work/api', 1]]);
    expect(presentCount(index(), T + 40 * SEC)).toBe(2);
  });
});

describe('what a person is doing at an instant', () => {
  test('status, how long, and what for when waiting', () => {
    expect(agent(5 * SEC, 'a:s1')).toMatchObject({ status: 'idle', statusSince: T });
    expect(agent(15 * SEC, 'a:s1')).toMatchObject({ status: 'working', statusSince: T + 10 * SEC });
    expect(agent(55 * SEC, 'a:s1')).toMatchObject({ status: 'waiting', statusSince: T + 50 * SEC, waitingFor: 'Aprovar Edit', waitingForMsg: { key: 'waiting.approve' } });
    expect(agent(75 * SEC, 'a:s1')?.waitingFor).toBeUndefined();
    expect(agent(110 * SEC, 'a:s1')).toMatchObject({ status: 'idle', statusSince: T + 100 * SEC });
  });

  test('a subagent starts working and is described by its task', () => {
    expect(agent(40 * SEC, 'a:s1:x')).toMatchObject({ kind: 'sub', parentId: 'a:s1', status: 'working', role: 'Explore', title: 'Explorar', startedAt: T + 33 * SEC });
  });

  test('current activity and the recent ones, oldest first', () => {
    const person = agent(35 * SEC, 'a:s1');

    expect(person?.activity).toMatchObject({ kind: 'subagent', icon: '👥', msg: { key: 'activity.subagent' } });
    expect(person?.recent.map((activity) => activity.kind)).toEqual(['prompt', 'read', 'subagent']);
    expect(agent(11 * SEC, 'a:s1')?.activity?.kind).toBe('prompt');
    expect(agent(5 * SEC, 'a:s1')?.activity).toBeUndefined();
  });

  test('activity ids are stable from one instant to the next, and new for a new activity', () => {
    const first = agent(25 * SEC, 'a:s1')?.activity?.id;

    expect(agent(26 * SEC, 'a:s1')?.activity?.id).toBe(first);
    expect(agent(31 * SEC, 'a:s1')?.activity?.id).not.toBe(first);
  });

  test('the task list as of the instant, with the age of each task', () => {
    const early = agent(15 * SEC, 'a:s1')?.tasks;
    const late = agent(95 * SEC, 'a:s1')?.tasks;

    expect(early?.map((task) => [task.title, task.status, task.changedAt])).toEqual([['Escrever', 'in_progress', T + 12 * SEC], ['Publicar', 'pending', T + 12 * SEC]]);
    expect(late?.map((task) => [task.title, task.status, task.changedAt])).toEqual([['Escrever', 'completed', T + 90 * SEC], ['Publicar', 'in_progress', T + 90 * SEC]]);
    expect(agent(5 * SEC, 'a:s1')?.tasks).toEqual([]);
  });

  test('a shell is running between its start and its end', () => {
    expect(agent(39 * SEC, 'a:s1')?.shells).toEqual([]);
    expect(agent(45 * SEC, 'a:s1')?.shells).toMatchObject([{ id: 'b1', label: 'npm test', background: false, kind: 'shell', startedAt: T + 40 * SEC }]);
    expect(agent(81 * SEC, 'a:s1')?.shells).toEqual([]);
  });

  test('counts the tool calls and the subagents so far', () => {
    expect(agent(25 * SEC, 'a:s1')?.stats).toMatchObject({ toolCalls: 1, subagents: 0 });
    expect(agent(35 * SEC, 'a:s1')?.stats).toMatchObject({ toolCalls: 2, subagents: 1 });
  });

  test('the last event is the latest of the status and the activity', () => {
    expect(agent(25 * SEC, 'a:s1')?.lastEventAt).toBe(T + 20 * SEC);
    expect(agent(55 * SEC, 'a:s1')?.lastEventAt).toBe(T + 50 * SEC);
  });
});

describe('the snapshot', () => {
  test('is a regular office snapshot at the replay time, with the accounts and meta it is given and no live data', () => {
    const snapshot = snapshotAt(index(), T + 40 * SEC, context(7));

    expect(snapshot).toMatchObject({ rev: 7, serverTime: T + 40 * SEC, meta: META, accounts: ACCOUNTS, usage: [] });
    expect(snapshot.hires).toBeUndefined();
    expect(snapshot.agents.every((person) => person.permission === undefined)).toBe(true);
  });

  test('seeking is deterministic: the state at an instant does not depend on how the clock got there', () => {
    const replay = index();
    const direct = snapshotAt(replay, T + 95 * SEC, context());
    for (const offset of [0, 200 * SEC, 7 * MIN, 30 * SEC, 99 * SEC, 5 * MIN, 95 * SEC]) snapshotAt(replay, T + offset, context());
    const afterwards = snapshotAt(replay, T + 95 * SEC, context());

    expect(afterwards).toEqual(direct);
    expect(snapshotAt(index(), T + 95 * SEC, context())).toEqual(direct);
  });

  test('does not change the replay it was built from', () => {
    const replay = index();
    const frozen = JSON.stringify(replay.timelapse);
    snapshotAt(replay, T + 95 * SEC, context());
    feedAt(replay, T + 95 * SEC, 10);

    expect(JSON.stringify(replay.timelapse)).toBe(frozen);
  });
});

describe('the feed', () => {
  test('lists the latest activities up to the instant, oldest first, with who did them', () => {
    const feed = feedAt(index(), T + 35 * SEC, 10);

    expect(feed.map((item) => [item.agentName, item.activity.kind])).toEqual([['Ana', 'prompt'], ['Ana', 'read'], ['Ana', 'subagent']]);
    expect(feed[0]).toMatchObject({ agentId: 'a:s1', projectId: '/work/loja' });
  });

  test('is limited to the most recent ones and empty before anything happened', () => {
    expect(feedAt(index(), T + 35 * SEC, 2).map((item) => item.activity.kind)).toEqual(['read', 'subagent']);
    expect(feedAt(index(), T, 10)).toEqual([]);
  });
});

describe('countUpTo', () => {
  test('counts the items at or before the instant', () => {
    const items = [{ at: 1 }, { at: 2 }, { at: 2 }, { at: 5 }];

    expect([0, 1, 2, 4, 5, 9].map((t) => countUpTo(items, t))).toEqual([0, 1, 3, 3, 4, 4]);
    expect(countUpTo([], 3)).toBe(0);
  });
});

describe('a full demo day', () => {
  const NOW = new Date(2026, 9, 21, 15, 30).getTime();
  const range = dayRange('2026-10-20');
  if (range === undefined) throw new Error('no range');
  const timelapse = demoTimelapse({ range, now: NOW, locale: 'en', agents: createDemoSimulator({ seed: 3, now: () => NOW }).agents(), account: 'all' });
  const replay = buildReplay(timelapse);
  const from = timelapse.from ?? 0;
  const to = timelapse.to ?? 0;

  test('has people in several rooms at some point, subagents among them', () => {
    let rooms = 0;
    let subs = 0;
    for (let t = from; t <= to; t += 5 * MIN) {
      const snapshot = snapshotAt(replay, t, context());
      rooms = Math.max(rooms, snapshot.projects.length);
      subs = Math.max(subs, snapshot.agents.filter((person) => person.kind === 'sub').length);
    }

    expect(rooms).toBeGreaterThanOrEqual(3);
    expect(subs).toBeGreaterThanOrEqual(1);
  });

  test('every person in every snapshot belongs to a room of the snapshot, whenever the clock is', () => {
    for (let t = from; t <= to; t += 7 * MIN) {
      const snapshot = snapshotAt(replay, t, context());
      const rooms = new Set(snapshot.projects.map((project) => project.id));

      expect(snapshot.agents.every((person) => rooms.has(person.projectId))).toBe(true);
    }
  });

  test('sequential playing and jumping give the same state', () => {
    const jumps = [to, from, (from + to) / 2, from + 3 * MIN, to - MIN];
    const played = new Map<number, unknown>();
    for (const t of jumps) played.set(t, snapshotAt(replay, t, context()));
    for (let t = from; t < to; t += 11 * MIN) snapshotAt(replay, t, context());

    for (const t of jumps) expect(snapshotAt(replay, t, context())).toEqual(played.get(t));
  });
});
