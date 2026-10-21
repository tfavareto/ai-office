import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { account, activity, agent, project, snapshot } from '../../test/fixtures';
import { agentsNeedingYou, agentsWithPermission, agentsWithShells, computeCounters, nextAfter } from './counters';
import { buildRooms, normalizeQuery } from './rooms';
import { displayStatus, shellStage } from './status';
import { filterSessions, groupSessionsByDay } from './sessions';
import { mergeTimeline, roomActivities } from './timeline';

beforeEach(() => setLocale('pt-BR'));
afterEach(() => setLocale('pt-BR'));

const shell = (id: string, startedAt: number, background = false) => ({
  id,
  label: 'npm test',
  background,
  kind: 'shell' as const,
  startedAt,
});

describe('displayStatus', () => {
  it('refines the model status', () => {
    expect(displayStatus(agent({ status: 'waiting' }))).toBe('waiting');
    expect(displayStatus(agent({ status: 'working', shells: [shell('s', 0)] }))).toBe('shell');
    expect(displayStatus(agent({ status: 'working', shells: [shell('s', 0, true)] }))).toBe('working');
    expect(displayStatus(agent({ status: 'idle', shells: [shell('s', 0, true)] }))).toBe('shell');
    expect(displayStatus(agent({ status: 'idle', activity: activity({ error: true }) }))).toBe('error');
    expect(displayStatus(agent({ status: 'idle' }))).toBe('idle');
  });

  it('moves a shell through its stages by elapsed time', () => {
    expect(shellStage({ startedAt: 0 }, 1_000).label).toBe('Iniciando');
    expect(shellStage({ startedAt: 0 }, 10_000).label).toBe('Rodando');
    expect(shellStage({ startedAt: 0 }, 90_000).label).toBe('Demorando');
    expect(shellStage({ startedAt: 0 }, 600_000).index).toBe(3);
  });

  it('names the stages in the current language', () => {
    setLocale('en');
    expect(shellStage({ startedAt: 0 }, 1_000).label).toBe('Starting');
    setLocale('es');
    expect(shellStage({ startedAt: 0 }, 90_000).label).toBe('Tardando');
  });
});

describe('counters', () => {
  const snap = snapshot({
    projects: [project({ id: 'p1' }), project({ id: 'p2', order: 1 })],
    agents: [
      agent({ id: 'a', status: 'working', projectId: 'p1', shells: [shell('s1', 5)] }),
      agent({ id: 'b', status: 'waiting', projectId: 'p2', statusSince: 50 }),
      agent({ id: 'c', kind: 'sub', parentId: 'a', status: 'working', projectId: 'p1' }),
      agent({ id: 'd', status: 'offline', projectId: 'p2' }),
    ],
  });

  it('counts rooms, agents, subagents, shells and who needs the user', () => {
    expect(computeCounters(snap)).toEqual({ rooms: 2, agents: 2, working: 2, subagents: 1, shells: 1, needsYou: 1 });
  });

  it('returns zeros without a snapshot', () => {
    expect(computeCounters(null).agents).toBe(0);
  });

  it('orders agents needing the user with permissions first, then oldest', () => {
    const list = agentsNeedingYou([
      agent({ id: 'x', status: 'waiting', statusSince: 10 }),
      agent({
        id: 'y',
        status: 'waiting',
        statusSince: 99,
        permission: {
          id: 'p',
          agentId: 'y',
          toolName: 'Bash',
          summary: 'ls',
          suggestions: [],
          createdAt: 0,
          expiresAt: 1,
        },
      }),
      agent({ id: 'z', status: 'waiting', statusSince: 5 }),
    ]);
    expect(list.map((a) => a.id)).toEqual(['y', 'z', 'x']);
    expect(agentsWithPermission(list).map((a) => a.id)).toEqual(['y']);
  });

  it('lists agents with shells, longest running first', () => {
    const list = agentsWithShells([
      agent({ id: 'late', shells: [shell('a', 90)] }),
      agent({ id: 'early', shells: [shell('b', 10)] }),
      agent({ id: 'none' }),
    ]);
    expect(list.map((a) => a.id)).toEqual(['early', 'late']);
  });

  it('cycles through items', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(nextAfter(items, null)?.id).toBe('a');
    expect(nextAfter(items, 'a')?.id).toBe('b');
    expect(nextAfter(items, 'c')?.id).toBe('a');
    expect(nextAfter(items, 'zzz')?.id).toBe('a');
    expect(nextAfter([], 'a')).toBeUndefined();
  });
});

describe('buildRooms', () => {
  const snap = snapshot({
    accounts: [account(), account({ id: 'acc2', label: 'Trabalho', initial: 'T' })],
    projects: [
      project({ id: 'p1', name: 'loja', order: 1 }),
      project({ id: 'p2', name: 'api', path: '/demo/api', order: 0 }),
    ],
    agents: [
      agent({ id: 'idle', name: 'Bruno', status: 'idle', projectId: 'p1' }),
      agent({
        id: 'busy',
        name: 'Ana',
        status: 'working',
        projectId: 'p1',
        tasks: [
          { id: 't1', title: 'x', status: 'completed' },
          { id: 't2', title: 'y', status: 'pending' },
        ],
      }),
      agent({ id: 'sub', kind: 'sub', parentId: 'busy', name: 'Caio', role: 'Explore', projectId: 'p1' }),
      agent({ id: 'other', name: 'Dora', accountId: 'acc2', projectId: 'p2' }),
      agent({ id: 'gone', name: 'Eli', status: 'offline', projectId: 'p2' }),
    ],
  });

  it('keeps rooms in arrival order and puts subagents under their parent', () => {
    const rooms = buildRooms(snap, { query: '', accountIds: [] });
    expect(rooms.map((r) => r.project.id)).toEqual(['p2', 'p1']);
    expect(rooms[1].rows.map((r) => `${r.depth}:${r.agent.id}`)).toEqual(['0:busy', '1:sub', '0:idle']);
    expect(rooms[1].tasksDone).toBe(1);
    expect(rooms[1].tasksTotal).toBe(2);
  });

  it('filters by account and by accent-insensitive search', () => {
    expect(buildRooms(snap, { query: '', accountIds: ['acc2'] }).map((r) => r.project.id)).toEqual(['p2']);
    expect(buildRooms(snap, { query: 'LOJA', accountIds: [] }).map((r) => r.project.id)).toEqual(['p1']);
    expect(buildRooms(snap, { query: 'trabalho', accountIds: [] }).map((r) => r.project.id)).toEqual(['p2']);
    expect(buildRooms(snap, { query: 'inexistente', accountIds: [] })).toEqual([]);
  });

  it('hides leaving agents unless selected', () => {
    expect(buildRooms(snap, { query: '', accountIds: [] })[0].rows.map((r) => r.agent.id)).toEqual(['other']);
    expect(buildRooms(snap, { query: '', accountIds: [] }, 'gone')[0].rows.map((r) => r.agent.id)).toContain('gone');
  });

  it('normalizes accents and case', () => {
    expect(normalizeQuery('  Ação ')).toBe('acao');
  });
});

describe('timeline', () => {
  it('merges recent and history by id, newest first', () => {
    const merged = mergeTimeline(
      [activity({ id: 'b', at: 20 }), activity({ id: 'c', at: 30 })],
      [activity({ id: 'a', at: 10 }), activity({ id: 'b', at: 20 })],
    );
    expect(merged.map((a) => a.id)).toEqual(['c', 'b', 'a']);
  });

  it('collects the latest activities across a room', () => {
    const a = agent({ id: 'a', recent: [activity({ id: '1', at: 5 })] });
    const b = agent({ id: 'b', recent: [activity({ id: '2', at: 9 })] });
    expect(roomActivities([a, b], 1)[0].activity.id).toBe('2');
  });
});

describe('sessions', () => {
  const day = 86_400_000;
  const now = 10 * day + 12 * 3_600_000;
  const base = { accountId: 'acc1', projectPath: '/x', open: false };
  const sessions = [
    { ...base, sessionId: '1', projectName: 'loja', title: 'Checkout', firstAt: now - 1000, lastAt: now - 500 },
    { ...base, sessionId: '2', projectName: 'api', title: undefined, firstAt: now - day, lastAt: now - day },
    {
      ...base,
      sessionId: '3',
      projectName: 'loja',
      title: 'Carrinho',
      firstAt: now - 3_600_000,
      lastAt: now - 1_800_000,
    },
  ];

  it('groups by day, newest first', () => {
    const groups = groupSessionsByDay(sessions, now);
    expect(groups.map((g) => g.label)).toEqual(['Hoje', 'Ontem']);
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(['1', '3']);
  });

  it('searches project and title', () => {
    expect(filterSessions(sessions, 'carrinho').map((s) => s.sessionId)).toEqual(['3']);
    expect(filterSessions(sessions, 'LOJA')).toHaveLength(2);
    expect(filterSessions(sessions, '')).toHaveLength(3);
  });
});
