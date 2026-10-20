import { describe, expect, test } from 'vitest';
import type { Agent, FeedItem, Notice } from '../model';
import { createDemoSimulator } from './simulator';

const T0 = 1_800_000_000_000;

function run(seed: number, seconds: number, stepMs = 250) {
  let clock = T0;
  const sim = createDemoSimulator({ seed, now: () => clock });
  const feed: FeedItem[] = [];
  const notices: Notice[] = [];
  for (let t = 0; t <= seconds * 1000; t += stepMs) {
    clock = T0 + t;
    const result = sim.tick(clock);
    feed.push(...result.feed);
    notices.push(...result.notices);
  }
  return { sim, feed, notices, clock };
}

const strip = (agents: Agent[]) =>
  agents.map((a) => ({ id: a.id, name: a.name, status: a.status, text: a.activity?.text, tasks: a.tasks.length, shells: a.shells.length }));

describe('createDemoSimulator', () => {
  test('starts with 4 projects and 6 main agents with distinct names', () => {
    const sim = createDemoSimulator({ seed: 1, now: () => T0 });
    const mains = sim.agents().filter((a) => a.kind === 'main');
    expect(sim.projects()).toHaveLength(4);
    expect(mains).toHaveLength(6);
    expect(new Set(sim.agents().map((a) => a.name)).size).toBe(sim.agents().length);
    expect(sim.projects().map((p) => p.order)).toEqual([0, 1, 2, 3]);
    expect(mains.every((a) => a.demo === true)).toBe(true);
  });

  test('is deterministic for the same seed and tick sequence', () => {
    const a = run(7, 120);
    const b = run(7, 120);
    expect(strip(a.sim.agents())).toEqual(strip(b.sim.agents()));
    expect(a.feed.map((f) => f.activity.text)).toEqual(b.feed.map((f) => f.activity.text));
    expect(a.notices.map((n) => n.text)).toEqual(b.notices.map((n) => n.text));
  });

  test('different seeds tell different stories', () => {
    const a = run(1, 120);
    const b = run(2, 120);
    expect(a.feed.map((f) => f.activity.text)).not.toEqual(b.feed.map((f) => f.activity.text));
  });

  test('opening scene shows variety: working, idle, waiting, a shell and subagents', () => {
    const { sim } = run(1, 8);
    const agents = sim.agents();
    const statuses = new Set(agents.map((a) => a.status));
    expect(statuses.has('working')).toBe(true);
    expect(statuses.has('idle')).toBe(true);
    expect(statuses.has('waiting')).toBe(true);
    expect(agents.some((a) => a.shells.length > 0)).toBe(true);
    expect(agents.some((a) => a.kind === 'sub')).toBe(true);
  });

  test('a longer run produces activities, notices, completions and subagents', () => {
    const { feed, notices } = run(3, 600);
    const kinds = new Set(feed.map((f) => f.activity.kind));
    for (const kind of ['prompt', 'read', 'edit', 'bash', 'done', 'subagent']) expect(kinds.has(kind as never)).toBe(true);
    expect(notices.some((n) => n.level === 'success')).toBe(true);
    expect(notices.some((n) => n.level === 'alert')).toBe(true);
    expect(feed.every((f) => f.activity.text.length <= 60)).toBe(true);
  });

  test('permission requests can be answered through decidePermission', () => {
    const { sim } = run(1, 6);
    const waiting = sim.agents().find((a) => a.permission !== undefined);
    expect(waiting).toBeDefined();
    const requestId = (waiting as Agent).permission!.id;
    expect(sim.decidePermission(requestId, { behavior: 'allow' })).toBe(true);
    const after = sim.agents().find((a) => a.id === waiting!.id);
    expect(after?.status).toBe('working');
    expect(after?.permission).toBeUndefined();
    expect(sim.decidePermission(requestId, { behavior: 'allow' })).toBe(false);
    expect(sim.decidePermission('nao-existe', { behavior: 'deny' })).toBe(false);
  });

  test('denying with interrupt ends the turn', () => {
    const { sim } = run(1, 6);
    const waiting = sim.agents().find((a) => a.permission !== undefined) as Agent;
    sim.decidePermission(waiting.permission!.id, { behavior: 'deny', message: 'não', interrupt: true });
    expect(sim.agents().find((a) => a.id === waiting.id)?.status).toBe('idle');
  });

  test('messages are delivered after about 1.5 seconds', () => {
    let clock = T0;
    const sim = createDemoSimulator({ seed: 1, now: () => clock });
    const target = sim.agents().find((a) => a.kind === 'main') as Agent;
    const [message] = sim.sendMessage([target.id], 'Como está indo?', clock);
    expect(message?.status).toBe('queued');
    clock = T0 + 1000;
    sim.tick(clock);
    expect(sim.messages(target.id)[0]?.status).toBe('queued');
    clock = T0 + 1700;
    const result = sim.tick(clock);
    const delivered = sim.messages(target.id)[0];
    expect(delivered?.status).toBe('delivered');
    expect(delivered?.via).toBe('demo');
    expect(result.feed.some((f) => f.agentId === target.id && f.activity.kind === 'message')).toBe(true);
  });

  test('team messages share a group id and unknown agents are ignored', () => {
    const sim = createDemoSimulator({ seed: 1, now: () => T0 });
    const ids = sim
      .agents()
      .filter((a) => a.kind === 'main')
      .slice(0, 2)
      .map((a) => a.id);
    const messages = sim.sendMessage([...ids, 'fantasma'], 'Pessoal, atenção', T0);
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((m) => m.group)).size).toBe(1);
    expect(messages[0]?.group).toBeDefined();
  });

  test('snapshot is standalone with demo accounts, usage and increasing rev', () => {
    const sim = createDemoSimulator({ seed: 1, now: () => T0 });
    const first = sim.snapshot(T0);
    const later = sim.snapshot(T0 + 20_000);
    expect(first.meta.demo).toBe(true);
    expect(first.accounts.length).toBeGreaterThanOrEqual(2);
    expect(first.usage).toHaveLength(first.accounts.length);
    expect(first.usage[0]?.window5h.tokens).toBeGreaterThan(0);
    expect(later.rev).toBeGreaterThan(first.rev);
    expect(later.agents.every((a) => first.accounts.some((acc) => acc.id === a.accountId))).toBe(true);
  });

  test('session count option controls projects (0 to 12)', () => {
    expect(createDemoSimulator({ sessions: 0, now: () => T0 }).projects()).toHaveLength(0);
    expect(createDemoSimulator({ sessions: 12, now: () => T0 }).projects()).toHaveLength(12);
    expect(createDemoSimulator({ sessions: 99, now: () => T0 }).projects()).toHaveLength(12);
  });

  test('spawnSession opens a project with subagents', () => {
    const sim = createDemoSimulator({ sessions: 1, seed: 5, now: () => T0 });
    sim.spawnSession({ project: 'novo-projeto', subs: 2, status: 'working' });
    expect(sim.projects().some((p) => p.name === 'novo-projeto')).toBe(true);
    expect(sim.agents().filter((a) => a.kind === 'sub')).toHaveLength(2);
  });

  test('spawnSession returns the id of the new main agent and honors account and title', () => {
    const sim = createDemoSimulator({ sessions: 1, seed: 5, now: () => T0 });

    const id = sim.spawnSession({ project: 'novo-projeto', accountId: 'demo-trabalho', title: 'Corrigir o login' });

    const agent = sim.agents().find((candidate) => candidate.id === id);
    expect(agent?.kind).toBe('main');
    expect(agent?.accountId).toBe('demo-trabalho');
    expect(agent?.title).toBe('Corrigir o login');
  });

  test('hire keeps a pending hire, then opens a session in that room and hands it over', () => {
    let clock = T0;
    const sim = createDemoSimulator({ sessions: 1, seed: 5, now: () => clock });
    const before = sim.agents().length;

    const hire = sim.hire({ project: 'loja-online', prompt: '  Revisar o checkout  ', deskIndex: 3, now: clock });

    expect(sim.hires(clock).map((item) => item.id)).toEqual([hire.id]);
    expect(hire).toMatchObject({ demo: true, projectId: expect.stringContaining('loja-online'), deskIndex: 3 });
    expect(sim.agents()).toHaveLength(before);

    clock = T0 + 10_000;
    sim.tick(clock);

    const resolved = sim.hires(clock)[0];
    expect(resolved?.agentId).toBeDefined();
    const agent = sim.agents().find((candidate) => candidate.id === resolved?.agentId);
    expect(agent?.projectId).toBe(hire.projectId);
    expect(agent?.title).toBe('Revisar o checkout');
    expect(sim.snapshot(clock).hires).toHaveLength(1);

    clock = T0 + 30_000;
    expect(sim.hires(clock)).toEqual([]);
    expect(sim.snapshot(clock).hires).toBeUndefined();
  });

  test('hire ignores an unknown account and uses the account of the project', () => {
    const sim = createDemoSimulator({ sessions: 1, seed: 5, now: () => T0 });

    const hire = sim.hire({ project: 'api-pagamentos', accountId: 'nope', now: T0 });

    expect(['demo-pessoal', 'demo-trabalho']).toContain(hire.accountId);
  });

  test('visitors arrive and leave over time without leaking agents', () => {
    const { sim, notices } = run(11, 1800, 1000);
    expect(notices.some((n) => n.level === 'info')).toBe(true);
    expect(sim.agents().length).toBeLessThan(20);
    const ids = new Set(sim.agents().map((a) => a.id));
    expect(sim.agents().every((a) => a.parentId === undefined || ids.has(a.parentId))).toBe(true);
  });

  test('speed multiplier makes the story advance faster', () => {
    let clock = T0;
    const slow = createDemoSimulator({ seed: 1, now: () => clock, speed: 1 });
    const fast = createDemoSimulator({ seed: 1, now: () => clock, speed: 4 });
    let slowCount = 0;
    let fastCount = 0;
    for (let t = 0; t <= 60_000; t += 250) {
      clock = T0 + t;
      slowCount += slow.tick(clock).feed.length;
      fastCount += fast.tick(clock).feed.length;
    }
    expect(fastCount).toBeGreaterThan(slowCount);
  });
});
