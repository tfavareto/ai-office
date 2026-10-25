import { describe, expect, test } from 'vitest';
import { TEAM_MAX_AGENTS, TEAM_MAX_MEMBERS } from './types';
import { parseSharePrefs, parseTeamShare, parseTeamView } from './validate';

const room = { key: 'r1', index: 1 };
const agent = { key: 'a1', name: 'Ana', roomKey: 'r1', kind: 'main', status: 'working', sinceAgeMs: 10, look: 'f' };

describe('parseTeamShare', () => {
  test('drops fields that are not in the allowlist', () => {
    const result = parseTeamShare({
      rooms: [{ ...room, path: '/secret' }],
      agents: [{ ...agent, sessionId: 's', command: 'rm -rf', activityKind: 'bash' }],
      extra: 1,
    });

    expect(result).toEqual({ rooms: [room], agents: [{ ...agent, activityKind: 'bash' }] });
  });

  test('refuses what is not a share, and agents with a bad status, key or room', () => {
    expect(parseTeamShare(null)).toBeUndefined();
    expect(parseTeamShare({ rooms: 1, agents: [] })).toBeUndefined();
    const result = parseTeamShare({
      rooms: [room],
      agents: [
        { ...agent, status: 'offline' },
        { ...agent, key: 'bad key!' },
        { ...agent, roomKey: 'ghost' },
        { ...agent, key: 'ok' },
      ],
    });
    expect(result?.agents.map((a) => a.key)).toEqual(['ok']);
  });

  test('cleans texts: control and bidi characters go, length is capped', () => {
    const result = parseTeamShare({
      rooms: [room],
      agents: [{ ...agent, name: `A‮b\u0000c${'x'.repeat(100)}`, title: 'y'.repeat(500) }],
    });
    expect(result?.agents[0]?.name).toBe(`Ab c${'x'.repeat(20)}`);
    expect(result?.agents[0]?.title?.length).toBe(80);
  });

  test('caps agents and rejects an absurdly large list outright', () => {
    const many = Array.from({ length: TEAM_MAX_AGENTS + 10 }, (_, i) => ({ ...agent, key: `k${i}` }));
    expect(parseTeamShare({ rooms: [room], agents: many })?.agents).toHaveLength(TEAM_MAX_AGENTS);
    const huge = Array.from({ length: TEAM_MAX_AGENTS * 2 + 1 }, (_, i) => ({ ...agent, key: `k${i}` }));
    expect(parseTeamShare({ rooms: [room], agents: huge })).toBeUndefined();
  });

  test('ignores negative, infinite and non-numeric numbers', () => {
    const result = parseTeamShare({
      rooms: [room],
      agents: [
        { ...agent, key: 'n1', tokens: -5, costUSD: Infinity },
        { ...agent, key: 'n2', sinceAgeMs: -1 },
      ],
    });
    expect(result?.agents).toHaveLength(1);
    expect(result?.agents[0]?.tokens).toBeUndefined();
    expect(result?.agents[0]?.costUSD).toBeUndefined();
  });
});

describe('parseTeamView', () => {
  test('rebuilds members and refuses duplicates and too many members', () => {
    const view = parseTeamView({
      teamName: 'Time A',
      members: [
        { id: 'm1', name: 'Ana', device: 'mac', host: true, online: true, share: { rooms: [room], agents: [agent] } },
        { id: 'm1', name: 'Dup', device: '', host: false, online: false },
        { id: 'm2', name: 'Beto', device: 'pc', host: false, online: false, lastSeenAgoMs: 5000, junk: true },
      ],
    });
    expect(view?.members.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(view?.members[1]).toEqual({
      id: 'm2',
      name: 'Beto',
      device: 'pc',
      host: false,
      online: false,
      lastSeenAgoMs: 5000,
    });
    const crowd = Array.from({ length: TEAM_MAX_MEMBERS + 2 }, (_, i) => ({ id: `m${i}`, name: 'x', online: true }));
    expect(parseTeamView({ teamName: 'T', members: crowd })).toBeUndefined();
  });
});

describe('parseSharePrefs', () => {
  test('anything but true is off', () => {
    expect(parseSharePrefs({ titles: 'yes', usage: 1, branches: true })).toEqual({
      paused: false,
      projectNames: false,
      activityText: false,
      titles: false,
      branches: true,
      usage: false,
    });
    expect(parseSharePrefs(undefined).usage).toBe(false);
  });
});
