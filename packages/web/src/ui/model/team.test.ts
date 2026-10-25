import { describe, expect, test } from 'vitest';
import type { OfficeSnapshot, TeamAgent, TeamPerson, TeamSnapshot } from '@ai-office/shared';
import { EMPTY_OVERLAY, agentIdOf, firstTeamOrder, personIdOf, teamCounts, teamOverlay, withTeam } from './team';

const agent = (key: string, extra: Partial<TeamAgent> = {}): TeamAgent => ({
  key,
  name: `Agente ${key}`,
  roomKey: 'r1',
  kind: 'main',
  status: 'working',
  sinceAgeMs: 1000,
  look: 'f',
  since: 5000,
  activityKind: 'edit',
  ...extra,
});

const person = (id: string, extra: Partial<TeamPerson> = {}): TeamPerson => ({
  id,
  name: 'Ana',
  device: 'mac',
  host: false,
  online: true,
  paused: false,
  rooms: [{ key: 'r1', index: 1 }],
  agents: [agent('a1'), agent('a2', { kind: 'sub' })],
  ...extra,
});

const team = (...people: TeamPerson[]): TeamSnapshot => ({
  role: 'member',
  teamName: 'T',
  link: 'connected',
  paused: false,
  people,
});

const local: OfficeSnapshot = {
  rev: 1,
  serverTime: 0,
  meta: { version: '1', startedAt: 0, local: true, demo: false },
  accounts: [{ id: 'acc', label: 'Pessoal', initial: 'P', color: '#fff', dir: '/x' }],
  projects: [{ id: '/p', name: 'p', path: '/p', seed: 1, order: 3 }],
  agents: [],
  usage: [],
};

describe('teamOverlay', () => {
  test('makes one account per member and one room per shared room, named "member · Projeto n"', () => {
    const overlay = teamOverlay(team(person('m1')), 4);

    expect(overlay.accounts).toHaveLength(1);
    expect(overlay.accounts[0]).toMatchObject({ id: 'team:m1', label: 'Ana', initial: 'A' });
    expect(overlay.projects[0]).toMatchObject({ id: 'team:m1:r1', name: 'Ana · Projeto 1', path: '', order: 4 });
    expect(overlay.projects[0]?.theme?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  test('uses the real room name only when the member shared it', () => {
    const named = teamOverlay(team(person('m1', { rooms: [{ key: 'r1', index: 1, name: 'Loja' }] })), 0);

    expect(named.projects[0]?.name).toBe('Ana · Loja');
  });

  test('turns shared agents into read-only people: no permission, tasks or shells, ids that cannot be local', () => {
    const overlay = teamOverlay(team(person('m1')), 0);
    const [main, sub] = overlay.agents;

    expect(main).toMatchObject({
      id: 'team:m1:a1',
      kind: 'main',
      accountId: 'team:m1',
      projectId: 'team:m1:r1',
      status: 'working',
    });
    expect(sub).toMatchObject({ kind: 'sub', parentId: 'team:m1:a1' });
    for (const a of overlay.agents) {
      expect(a.permission).toBeUndefined();
      expect(a.tasks).toEqual([]);
      expect(a.shells).toEqual([]);
      expect(a.activity).toMatchObject({ kind: 'edit', msg: { key: 'team.act.edit' } });
    }
  });

  test('a subagent with no main agent in its room is drawn as a person of its own', () => {
    const overlay = teamOverlay(team(person('m1', { agents: [agent('s1', { kind: 'sub' })] })), 0);

    expect(overlay.agents[0]?.kind).toBe('main');
    expect(overlay.agents[0]?.parentId).toBeUndefined();
  });

  test('shows opt-in details only when they came', () => {
    const plain = teamOverlay(team(person('m1', { agents: [agent('a1')] })), 0).agents[0];
    const rich = teamOverlay(
      team(
        person('m1', {
          agents: [
            agent('a1', {
              title: 'Corrigir login',
              branch: 'fix/x',
              activityText: 'Editando App.tsx',
              tokens: 10,
              costUSD: 0.5,
            }),
          ],
        }),
      ),
      0,
    ).agents[0];

    expect(plain?.title).toBeUndefined();
    expect(plain?.gitBranch).toBeUndefined();
    expect(rich).toMatchObject({ title: 'Corrigir login', gitBranch: 'fix/x', activity: { text: 'Editando App.tsx' } });
    expect(rich?.stats.costUSD).toBe(0.5);
  });

  test('a waiting teammate is waiting for an answer, not for you', () => {
    const waiting = teamOverlay(team(person('m1', { agents: [agent('a1', { status: 'waiting' })] })), 0).agents[0];

    expect(waiting?.waitingForMsg).toEqual({ key: 'team.status.waiting' });
    expect(waiting?.permission).toBeUndefined();
  });

  test('offline and empty members draw nothing', () => {
    const overlay = teamOverlay(team(person('m1', { online: false }), person('m2', { rooms: [], agents: [] })), 0);

    expect(overlay).toEqual(EMPTY_OVERLAY);
  });

  test('rooms of several members follow one another in order', () => {
    const overlay = teamOverlay(team(person('m1'), person('m2')), 7);

    expect(overlay.projects.map((p) => p.order)).toEqual([7, 8]);
  });
});

describe('withTeam', () => {
  const overlay = teamOverlay(team(person('m1')), firstTeamOrder(local));

  test('all adds the team after the local rooms', () => {
    const merged = withTeam(local, overlay, 'all');

    expect(merged.projects.map((p) => p.id)).toEqual(['/p', 'team:m1:r1']);
    expect(merged.accounts.map((a) => a.id)).toEqual(['acc', 'team:m1']);
    expect(overlay.projects[0]?.order).toBe(4);
  });

  test('team shows only the team, mine only the local office', () => {
    expect(withTeam(local, overlay, 'team').projects.map((p) => p.id)).toEqual(['team:m1:r1']);
    expect(withTeam(local, overlay, 'mine')).toBe(local);
    expect(withTeam(local, EMPTY_OVERLAY, 'all')).toBe(local);
  });
});

describe('helpers', () => {
  test('ids carry the member', () => {
    expect(personIdOf(agentIdOf('m1', 'a1'))).toBe('m1');
    expect(personIdOf('/work/p')).toBeUndefined();
  });

  test('counts online people and their agents', () => {
    expect(teamCounts(team(person('m1'), person('m2', { online: false, agents: [] })))).toEqual({
      online: 1,
      total: 2,
      agents: 2,
    });
    expect(teamCounts(undefined)).toEqual({ online: 0, total: 0, agents: 0 });
  });
});
