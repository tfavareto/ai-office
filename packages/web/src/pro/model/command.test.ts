import { describe, expect, it } from 'vitest';
import { agent, project, snapshot } from '../../test/fixtures';
import { STANDBY_MS, buildTargets, canSend, defaultTargetKey, outlookFor, resolveTargetKey } from './command';

const NOW = 5_000_000;

const world = snapshot({
  projects: [project({ id: 'p1', name: 'loja', order: 0 }), project({ id: 'p2', name: 'api', order: 1 })],
  agents: [
    agent({ id: 'a', name: 'Ana', projectId: 'p1', startedAt: 1, status: 'idle', statusSince: NOW - 1000 }),
    agent({ id: 'b', name: 'Bia', projectId: 'p1', startedAt: 2, status: 'working' }),
    agent({ id: 'b1', kind: 'sub', parentId: 'b', name: 'Beto', projectId: 'p1', status: 'working' }),
    agent({ id: 'c', name: 'Caio', projectId: 'p2', startedAt: 3, status: 'working', source: 'codex' }),
    agent({ id: 'd', name: 'Duda', projectId: 'p2', startedAt: 4, status: 'offline' }),
  ],
});

describe('outlookFor', () => {
  it('tells what a message will meet, by what the agent is doing', () => {
    expect(outlookFor(agent({ status: 'working' }), NOW)).toBe('afterTool');
    expect(outlookFor(agent({ status: 'waiting' }), NOW)).toBe('afterPermission');
    expect(outlookFor(agent({ status: 'idle', statusSince: NOW - 60_000 }), NOW)).toBe('standby');
    expect(outlookFor(agent({ status: 'idle', statusSince: NOW - STANDBY_MS - 1 }), NOW)).toBe('beyondStandby');
    expect(outlookFor(agent({ status: 'offline' }), NOW)).toBe('blocked');
    expect(outlookFor(agent({ status: 'working', source: 'codex' }), NOW)).toBe('blocked');
  });
});

describe('buildTargets', () => {
  it('offers the room team before the orchestrators of a room with more than one', () => {
    const targets = buildTargets(world, NOW, true);
    expect(targets.map((target) => target.key)).toEqual(['room:p1', 'agent:a', 'agent:b', 'agent:c']);
    expect(targets[0]).toMatchObject({ kind: 'room', label: 'loja', agentIds: ['a', 'b'], skipped: 0, blocked: null });
  });

  it('leaves out ended sessions and subagents, and blocks Codex with its reason', () => {
    const targets = buildTargets(world, NOW, true);
    expect(targets.find((target) => target.key === 'agent:d')).toBeUndefined();
    expect(targets.find((target) => target.key === 'agent:b1')).toBeUndefined();
    expect(targets.find((target) => target.key === 'agent:c')).toMatchObject({ blocked: 'codex', agentIds: [] });
  });

  it('counts the Codex agents a team message skips and blocks a team of only Codex agents', () => {
    const mixed = snapshot({
      projects: [project({ id: 'p1' })],
      agents: [
        agent({ id: 'a', projectId: 'p1', startedAt: 1 }),
        agent({ id: 'x', projectId: 'p1', startedAt: 2, source: 'codex' }),
        agent({ id: 'y', projectId: 'p1', startedAt: 3, source: 'codex' }),
      ],
    });
    expect(buildTargets(mixed, NOW, true)[0]).toMatchObject({ key: 'room:p1', agentIds: ['a'], skipped: 2 });
    const onlyCodex = snapshot({
      projects: [project({ id: 'p1' })],
      agents: [
        agent({ id: 'x', projectId: 'p1', startedAt: 2, source: 'codex' }),
        agent({ id: 'y', projectId: 'p1', startedAt: 3, source: 'codex' }),
      ],
    });
    expect(buildTargets(onlyCodex, NOW, true)[0]).toMatchObject({ blocked: 'team-codex' });
  });

  it('blocks everything when the page is not local', () => {
    expect(buildTargets(world, NOW, false).every((target) => target.blocked === 'local')).toBe(true);
    expect(buildTargets(null, NOW, true)).toEqual([]);
  });

  it('summarizes the outlook of a team by its slowest member', () => {
    const targets = buildTargets(world, NOW, true);
    expect(targets[0]?.outlook).toBe('standby');
  });
});

describe('default target', () => {
  const targets = buildTargets(world, NOW, true);

  it('follows the selected agent, a subagent counting as its orchestrator', () => {
    expect(defaultTargetKey(targets, world, 'a')).toBe('agent:a');
    expect(defaultTargetKey(targets, world, 'b1')).toBe('agent:b');
  });

  it('falls back to a busy orchestrator that can receive messages, then to the first', () => {
    expect(defaultTargetKey(targets, world, null)).toBe('agent:b');
    expect(defaultTargetKey(targets, world, 'gone')).toBe('agent:b');
    expect(defaultTargetKey([], null, null)).toBeNull();
  });

  it('keeps the choice of the user while it exists', () => {
    expect(resolveTargetKey(targets, 'agent:a', 'agent:b')).toBe('agent:a');
    expect(resolveTargetKey(targets, 'agent:zzz', 'agent:b')).toBe('agent:b');
    expect(resolveTargetKey(targets, null, 'agent:b')).toBe('agent:b');
  });
});

describe('canSend', () => {
  const [room, ana, , codex] = buildTargets(world, NOW, true);

  it('needs a target that can receive, a text and no send in progress', () => {
    expect(canSend(ana, 'faça isso', false)).toBe(true);
    expect(canSend(room, 'faça isso', false)).toBe(true);
    expect(canSend(ana, '   ', false)).toBe(false);
    expect(canSend(ana, 'x', true)).toBe(false);
    expect(canSend(codex, 'x', false)).toBe(false);
    expect(canSend(undefined, 'x', false)).toBe(false);
  });
});
