import { describe, expect, test } from 'vitest';
import { parseTeamSnapshot, parseTeamStatus } from './parse-team';

const person = {
  id: 'm1',
  name: 'Ana',
  device: 'mac',
  host: false,
  online: true,
  paused: false,
  rooms: [{ key: 'r1', index: 1 }],
  agents: [
    {
      key: 'a1',
      name: 'Bia',
      roomKey: 'r1',
      kind: 'main',
      status: 'working',
      sinceAgeMs: 5,
      look: 'f',
      since: 1234,
      activityKind: 'edit',
    },
  ],
};

describe('parseTeamSnapshot', () => {
  test('keeps a valid team and the time each status began', () => {
    const team = parseTeamSnapshot({
      role: 'member',
      teamName: 'Time',
      link: 'connected',
      paused: false,
      people: [person],
    });

    expect(team?.people[0]?.agents[0]).toMatchObject({ name: 'Bia', since: 1234, activityKind: 'edit' });
    expect(team).toMatchObject({ role: 'member', link: 'connected' });
  });

  test('drops people and fields that are not valid, and unknown links', () => {
    const team = parseTeamSnapshot({
      role: 'host',
      teamName: 'T',
      link: 'listening',
      people: [{ ...person, id: '' }, { ...person, agents: [{ ...person.agents[0], status: 'hacked' }] }, 5],
    });

    expect(team?.people).toHaveLength(1);
    expect(team?.people[0]?.agents).toEqual([]);
    expect(parseTeamSnapshot({ role: 'member', teamName: 'T', link: 'flying', people: [] })).toBeUndefined();
    expect(parseTeamSnapshot(null)).toBeUndefined();
    expect(parseTeamSnapshot({ role: 'boss', teamName: 'T', link: 'connected' })).toBeUndefined();
  });
});

describe('parseTeamStatus', () => {
  test('parses a hosting status and ignores junk', () => {
    const status = parseTeamStatus({
      available: true,
      role: 'host',
      sharing: { paused: true, usage: 'yes', branches: true },
      interfaces: [{ name: 'en0', address: '192.168.0.2' }, { name: 3 }],
      host: {
        teamName: 'Time',
        hostName: 'Helena',
        link: 'listening',
        address: '192.168.0.2',
        port: 4849,
        pairing: { code: 'ABCD-EFGH', expiresAt: 99, locked: false },
        members: [{ id: 'm1', name: 'Ana', device: 'mac', online: false, createdAt: 1 }, { id: 5 }],
        error: 'nope',
      },
    });

    expect(status.sharing).toMatchObject({ paused: true, usage: false, branches: true });
    expect(status.interfaces).toEqual([{ name: 'en0', address: '192.168.0.2' }]);
    expect(status.host?.members).toHaveLength(1);
    expect(status.host?.pairing).toEqual({ code: 'ABCD-EFGH', expiresAt: 99, locked: false });
    expect(status.host?.error).toBeUndefined();
  });

  test('refuses what is not a status', () => {
    expect(() => parseTeamStatus({ role: 'host' })).toThrow();
  });
});
