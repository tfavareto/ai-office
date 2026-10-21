import { describe, expect, test } from 'vitest';
import { type ReportCommit, type TimelapseEvent, TIMELAPSE_IDLE_LEAVE_MS, TIMELAPSE_MAX_AGENTS, pickName } from '@ai-office/shared';
import type { FileDay } from '../report/accumulator';
import { T0 } from '../test-helpers';
import { type BuildInput, type SessionTrace, SUB_LEAVE_AFTER_MS, TAIL_MS, type TraceFile, buildTimelapse } from './build';
import type { FileTrace, TraceEvent } from './recorder';

const MIN = 60_000;
const SEC = 1000;
const DAY_START = T0 - 12 * 60 * MIN;
const DAY_END = DAY_START + 24 * 60 * MIN;

function day(over: Partial<FileDay> = {}): FileDay {
  return { role: 'main', cwd: '/work/loja', title: undefined, firstAt: undefined, lastAt: undefined, prompts: 0, requests: [], toolCalls: {}, files: [], commands: [], tests: [], commits: [], tasks: [], subagentCount: 0, subagentTypes: [], activity: [], ...over };
}

function trace(over: Partial<FileTrace> & { from: number; to: number }): FileTrace {
  const { from, to, ...rest } = over;
  return { firstAt: from, lastAt: to, title: undefined, spans: [{ from, to }], events: [], spawns: [], thinned: false, ...rest };
}

const status = (at: number, state: 'working' | 'waiting' | 'idle', extra: Partial<Extract<TraceEvent, { t: 'status' }>> = {}): TraceEvent => ({ at, t: 'status', status: state, ...extra });
const activity = (at: number, text = 'Lendo a.ts'): TraceEvent => ({ at, t: 'activity', kind: 'read', icon: '📖', text, msg: { key: 'activity.read', params: { file: 'a.ts' } } });

function main(tr: FileTrace, dayOver: Partial<FileDay> = {}): SessionTrace['files'][number] {
  return { agent: '', day: day({ cwd: '/work/loja', ...dayOver }), trace: tr };
}

function input(sessions: SessionTrace[], over: Partial<BuildInput> = {}): BuildInput {
  return {
    date: '2026-10-19',
    start: DAY_START,
    end: DAY_END,
    now: DAY_END + 1,
    account: 'all',
    sessions,
    personOf: (id, taken) => pickName(id, taken),
    recordedOf: () => undefined,
    gitCommitsOf: () => [],
    truncated: false,
    ...over,
  };
}

const session = (id: string, files: TraceFile[], accountId = 'claude'): SessionTrace => ({ accountId, sessionId: id, files });
const types = (events: readonly TimelapseEvent[], agent: number) => events.filter((event) => 'agent' in event && event.agent === agent).map((event) => event.type);

describe('presence', () => {
  test('a main agent arrives at its first event and leaves 30 minutes after its last', () => {
    const colleague = session('s2', [main(trace({ from: T0 + 60 * MIN, to: T0 + 70 * MIN }), { cwd: '/work/api' })]);
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 10 * MIN, events: [status(T0, 'working'), status(T0 + 10 * MIN, 'idle')] }))]), colleague]));

    expect(tl.agents[0]).toMatchObject({ id: 'claude:s1', kind: 'main', projectId: '/work/loja', role: 'Principal', roleMsg: { key: 'agent.role.main' } });
    expect(tl.events.filter((event) => (event.type === 'arrive' || event.type === 'leave') && event.agent === 0)).toEqual([
      { at: T0, type: 'arrive', agent: 0 },
      { at: T0 + 10 * MIN + TIMELAPSE_IDLE_LEAVE_MS, type: 'leave', agent: 0 },
    ]);
  });

  test('a long gap makes the agent leave and arrive again', () => {
    const spans = [
      { from: T0, to: T0 + 5 * MIN },
      { from: T0 + 3 * 60 * MIN, to: T0 + 3 * 60 * MIN + MIN },
    ];
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 181 * MIN, spans, events: [status(T0, 'working'), status(T0 + 5 * MIN, 'idle'), status(T0 + 180 * MIN, 'working')] }))])], { now: DAY_END }));

    expect(types(tl.events, 0)).toEqual(['arrive', 'status', 'status', 'leave', 'arrive', 'status']);
    expect(tl.events.filter((event) => event.type === 'status').map((event) => (event.type === 'status' ? event.status : ''))).toEqual(['working', 'idle', 'working']);
  });

  test('an agent whose session is still going stays: no leave event until the 30 minutes have passed', () => {
    const now = T0 + 10 * MIN;
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 5 * MIN, events: [status(T0, 'working')] }))])], { now }));

    expect(tl.events.some((event) => event.type === 'leave')).toBe(false);
    expect(tl.to).toBe(T0 + 5 * MIN + TAIL_MS);
  });

  test('the status at arrival repeats the last known one', () => {
    const spans = [
      { from: T0, to: T0 + MIN },
      { from: T0 + 200 * MIN, to: T0 + 201 * MIN },
    ];
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 201 * MIN, spans, events: [status(T0, 'working'), status(T0 + MIN, 'idle')] }))])], { now: DAY_END }));

    const second = tl.events.filter((event) => event.type === 'status' && event.at === T0 + 200 * MIN);
    expect(second).toMatchObject([{ status: 'idle' }]);
  });
});

describe('subagents', () => {
  const sub = (id: string, from: number, to: number, meta?: TraceFile['meta']): TraceFile => ({ agent: id, day: day({ role: 'sub' }), trace: trace({ from, to, events: [status(from, 'working'), activity(from + 5 * SEC)] }), ...(meta !== undefined ? { meta } : {}) });
  const parent = main(trace({ from: T0, to: T0 + 20 * MIN, events: [status(T0, 'working')], spawns: [{ toolUseId: 'tu1', at: T0 + 2 * MIN, doneAt: T0 + 6 * MIN, description: 'Mapear módulos', subagentType: 'Explore' }] }));

  test('a subagent arrives when it is spawned and leaves when its call returns, matched by the tool call id', () => {
    const tl = buildTimelapse(input([session('s1', [parent, sub('a1', T0 + 2 * MIN + 3 * SEC, T0 + 5 * MIN, { toolUseId: 'tu1', agentType: 'Explore' })])]));

    expect(tl.agents[1]).toMatchObject({ id: 'claude:s1:a1', kind: 'sub', parentId: 'claude:s1', role: 'Explore', title: 'Mapear módulos' });
    const events = tl.events.filter((event) => 'agent' in event && event.agent === 1);
    expect(events[0]).toEqual({ at: T0 + 2 * MIN, type: 'arrive', agent: 1 });
    expect(events[events.length - 1]).toEqual({ at: T0 + 6 * MIN, type: 'leave', agent: 1 });
  });

  test('without the meta file the closest earlier spawn is used; without any spawn it leaves two minutes after its last event', () => {
    const lonely = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 20 * MIN })), sub('a1', T0 + 10 * MIN, T0 + 11 * MIN)])]));
    expect(lonely.agents[1]).toMatchObject({ role: 'Subagente', roleMsg: { key: 'agent.role.sub' } });
    expect(lonely.events.find((event) => event.type === 'leave' && event.agent === 1)?.at).toBe(T0 + 11 * MIN + SUB_LEAVE_AFTER_MS);

    const matched = buildTimelapse(input([session('s1', [parent, sub('a1', T0 + 2 * MIN + SEC, T0 + 4 * MIN)])]));
    expect(matched.agents[1]).toMatchObject({ role: 'Explore', title: 'Mapear módulos' });
  });

  test('a subagent is working unless it waits for the person: resting is not a thing for it', () => {
    const file = sub('a1', T0 + 2 * MIN, T0 + 5 * MIN);
    const withIdle: TraceFile = { ...file, trace: trace({ from: T0 + 2 * MIN, to: T0 + 5 * MIN, events: [status(T0 + 2 * MIN, 'idle'), status(T0 + 3 * MIN, 'waiting'), status(T0 + 4 * MIN, 'idle')] }) };
    const tl = buildTimelapse(input([session('s1', [parent, withIdle])]));

    expect(tl.events.filter((event) => event.type === 'status' && event.agent === 1).map((event) => (event.type === 'status' ? event.status : ''))).toEqual(['working', 'waiting', 'working']);
  });

  test('a subagent without a main transcript in the day is left out', () => {
    const tl = buildTimelapse(input([session('s1', [sub('a1', T0, T0 + MIN)])]));

    expect(tl.agents).toEqual([]);
  });
});

describe('projects, commits and tests', () => {
  test('rooms are numbered by the order people first arrived in them', () => {
    const a = session('s1', [main(trace({ from: T0 + 30 * MIN, to: T0 + 40 * MIN }), { cwd: '/work/api' })]);
    const b = session('s2', [main(trace({ from: T0, to: T0 + 10 * MIN }), { cwd: '/work/loja' })]);
    const tl = buildTimelapse(input([a, b]));

    expect(tl.projects.map((project) => [project.id, project.name, project.order])).toEqual([
      ['/work/loja', 'loja', 0],
      ['/work/api', 'api', 1],
    ]);
    expect(tl.agents.map((agent) => agent.projectId)).toEqual(['/work/loja', '/work/api']);
  });

  test('merges the commits of the transcript with the ones Git saw, once each', () => {
    const transcript: ReportCommit = { hash: 'abc1234', subject: 'feat: x', at: T0 + 5 * MIN, source: 'transcript', branch: 'main' };
    const git: ReportCommit[] = [
      { hash: 'abc1234deadbeef', subject: 'feat: x', at: T0 + 5 * MIN, source: 'git' },
      { hash: 'fff0000', subject: 'chore: by hand', at: T0 + 8 * MIN, source: 'git' },
    ];
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 10 * MIN }), { commits: [transcript] })])], { gitCommitsOf: () => git }));

    const commits = tl.events.filter((event) => event.type === 'commit');
    expect(commits).toEqual([
      { at: T0 + 5 * MIN, type: 'commit', project: 0, agent: 0, hash: 'abc1234', subject: 'feat: x', branch: 'main' },
      { at: T0 + 8 * MIN, type: 'commit', project: 0, hash: 'fff0000', subject: 'chore: by hand' },
    ]);
  });

  test('test runs keep their outcome and counts, and a failed run stays a failed run', () => {
    const tests = [
      { runner: 'vitest', at: T0 + MIN, outcome: 'passed' as const, passed: 12 },
      { runner: 'vitest', at: T0 + 2 * MIN, outcome: 'failed' as const, passed: 10, failed: 2 },
    ];
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 10 * MIN }), { tests })])]));

    expect(tl.events.filter((event) => event.type === 'test')).toEqual([
      { at: T0 + MIN, type: 'test', agent: 0, runner: 'vitest', outcome: 'passed', passed: 12 },
      { at: T0 + 2 * MIN, type: 'test', agent: 0, runner: 'vitest', outcome: 'failed', passed: 10, failed: 2 },
    ]);
  });

  test('a command in a commit subject cannot carry a credential', () => {
    const commit: ReportCommit = { hash: 'abc1234', subject: 'fix: call with --token=s3cr3tvalue', at: T0 + MIN, source: 'transcript' };
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 10 * MIN }), { commits: [commit] })])]));

    expect(JSON.stringify(tl)).not.toContain('s3cr3tvalue');
  });
});

describe('the whole day', () => {
  test('events are time ordered, the replay range ends shortly after the last event and the recorded times are attached', () => {
    const events = [activity(T0 + 5 * MIN), status(T0, 'working'), { at: T0 + 2 * MIN, t: 'shell' as const, on: true, id: 'b1', background: true, label: 'npm run dev' }];
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 10 * MIN, events }))])], { recordedOf: () => ({ working: 1, waiting: 2, idle: 3 }), personOf: () => ({ name: 'Ana', look: 'f' }) }));

    expect(tl.events.map((event) => event.at)).toEqual([...tl.events.map((event) => event.at)].sort((a, b) => a - b));
    expect(tl.from).toBe(T0);
    expect(tl.to).toBe(T0 + 10 * MIN + TAIL_MS);
    expect(tl.agents[0]).toMatchObject({ name: 'Ana', look: 'f', recordedMs: { working: 1, waiting: 2, idle: 3 } });
  });

  test('closes the shells that were still running when an agent leaves', () => {
    const events = [status(T0, 'working'), { at: T0 + MIN, t: 'shell' as const, on: true, id: 'b1', background: true, label: 'npm run dev' }];
    const colleague = session('s2', [main(trace({ from: T0 + 60 * MIN, to: T0 + 90 * MIN }), { cwd: '/work/api' })]);
    const tl = buildTimelapse(input([session('s1', [main(trace({ from: T0, to: T0 + 2 * MIN, events }))]), colleague], { now: DAY_END }));

    const shells = tl.events.filter((event) => event.type === 'shell');
    expect(shells).toMatchObject([{ on: true, at: T0 + MIN }, { on: false, at: T0 + 2 * MIN + TIMELAPSE_IDLE_LEAVE_MS }]);
  });

  test('names are unique inside the day', () => {
    const files = (id: string, at: number) => session(id, [main(trace({ from: at, to: at + MIN }))]);
    const tl = buildTimelapse(input([files('a', T0), files('b', T0 + MIN), files('c', T0 + 2 * MIN)]));

    expect(new Set(tl.agents.map((agent) => agent.name)).size).toBe(3);
  });

  test('an empty day has no from and to, and carries the truncation flag', () => {
    const tl = buildTimelapse(input([], { truncated: true }));

    expect(tl).toMatchObject({ projects: [], agents: [], events: [], truncated: true });
    expect(tl.from).toBeUndefined();
  });

  test('sessions without a working directory or events are skipped, and the number of people is capped', () => {
    const empty: SessionTrace = session('x', [{ agent: '', day: day({ cwd: undefined }), trace: trace({ from: T0, to: T0 + MIN }) }]);
    const none: SessionTrace = session('y', [{ agent: '', day: day(), trace: { firstAt: undefined, lastAt: undefined, title: undefined, spans: [], events: [], spawns: [], thinned: false } }]);
    const many = Array.from({ length: TIMELAPSE_MAX_AGENTS + 20 }, (_, i) => session(`s${i}`, [main(trace({ from: T0 + i * SEC, to: T0 + i * SEC + MIN }))]));
    const tl = buildTimelapse(input([empty, none, ...many]));

    expect(tl.agents).toHaveLength(TIMELAPSE_MAX_AGENTS);
    expect(tl.agents.some((agent) => agent.id === 'claude:x' || agent.id === 'claude:y')).toBe(false);
  });
});
