import { describe, expect, it } from 'vitest';
import { agent, snapshot } from '../test/fixtures';
import {
  parseActivities,
  parseDay,
  parseFeed,
  parseMessages,
  parseNotice,
  parseSessions,
  parseSnapshot,
  parseTranscriptPage,
} from './parse';

describe('parseSnapshot', () => {
  it('accepts a valid snapshot', () => {
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot({ rev: 7 }))));
    expect(parsed?.rev).toBe(7);
    expect(parsed?.agents).toHaveLength(1);
  });

  it('rejects malformed payloads', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ rev: 'x' })).toBeNull();
    expect(parseSnapshot({ rev: 1, serverTime: 1, meta: {}, accounts: [], projects: [] })).toBeNull();
  });

  it('fills missing agent collections and drops broken agents', () => {
    const raw = JSON.parse(JSON.stringify(snapshot()));
    delete raw.agents[0].recent;
    delete raw.agents[0].tasks;
    delete raw.agents[0].shells;
    delete raw.agents[0].stats;
    raw.agents.push({ nope: true }, 'garbage');
    const parsed = parseSnapshot(raw);
    expect(parsed?.agents).toHaveLength(1);
    expect(parsed?.agents[0].recent).toEqual([]);
    expect(parsed?.agents[0].shells).toEqual([]);
    expect(parsed?.agents[0].stats.toolCalls).toBe(0);
  });

  it('normalizes permission suggestions', () => {
    const raw = JSON.parse(
      JSON.stringify(
        snapshot({
          agents: [
            agent({
              permission: {
                id: 'p',
                agentId: 'ag1',
                toolName: 'Bash',
                summary: 'ls',
                suggestions: [],
                createdAt: 0,
                expiresAt: 1,
              },
            }),
          ],
        }),
      ),
    );
    raw.agents[0].permission.suggestions = ['ok', 3, null];
    expect(parseSnapshot(raw)?.agents[0].permission?.suggestions).toEqual(['ok']);
  });
});

describe('parseSnapshot with customization', () => {
  it('keeps valid looks, themes and flags and drops what is not valid', () => {
    const raw = JSON.parse(
      JSON.stringify(
        snapshot({
          projects: [{ id: 'p', name: 'Casa', path: '/p', seed: 1, order: 0 }],
          agents: [agent({ id: 'a' })],
        }),
      ),
    ) as Record<string, unknown>;
    const projects = raw.projects as Record<string, unknown>[];
    Object.assign(projects[0] as object, {
      theme: { floor: 'wood', wall: 'lava', color: '#ABCDEF' },
      originalName: 'p',
      pinned: true,
      hidden: 'yes',
      rank: 2,
    });
    Object.assign((raw.agents as object[])[0] as object, {
      appearance: { skin: 'tan', outfit: 'nope', accessory: 'cap' },
      defaultName: 'Ana',
    });
    const parsed = parseSnapshot(raw);
    expect(parsed?.projects[0]).toMatchObject({
      theme: { floor: 'wood', color: '#abcdef' },
      originalName: 'p',
      pinned: true,
      rank: 2,
    });
    expect(parsed?.projects[0]?.hidden).toBeUndefined();
    expect(parsed?.projects[0]?.theme?.wall).toBeUndefined();
    expect(parsed?.agents[0]).toMatchObject({ appearance: { skin: 'tan', accessory: 'cap' }, defaultName: 'Ana' });
    expect(parsed?.agents[0]?.appearance?.outfit).toBeUndefined();
  });
});

describe('parseSnapshot: session sources', () => {
  it('keeps the Codex source of agents and accounts', () => {
    const base = snapshot({ agents: [agent({ source: 'codex' })] });
    const raw = JSON.parse(JSON.stringify({ ...base, accounts: [{ ...base.accounts[0], source: 'codex' }] }));
    const parsed = parseSnapshot(raw);
    expect(parsed?.agents[0]?.source).toBe('codex');
    expect(parsed?.accounts[0]?.source).toBe('codex');
  });

  it('drops a source this build does not know', () => {
    const raw = JSON.parse(JSON.stringify(snapshot({ agents: [agent()] })));
    raw.agents[0].source = 'gemini';
    raw.accounts[0].source = 'gemini';
    const parsed = parseSnapshot(raw);
    expect(parsed?.agents[0]).not.toHaveProperty('source');
    expect(parsed?.accounts[0]).not.toHaveProperty('source');
  });

  it('leaves Claude Code agents unmarked', () => {
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot())));
    expect(parsed?.agents[0]).not.toHaveProperty('source');
  });
});

describe('list parsers', () => {
  it('keeps only well-formed items', () => {
    const activity = { id: 'a', at: 1, kind: 'read', icon: 'x', text: 't' };
    expect(parseActivities({ activities: [activity, { id: 1 }, null] })).toHaveLength(1);
    expect(parseActivities('nope')).toEqual([]);
    const message = { id: 'm', agentId: 'a', text: 'oi', createdAt: 1, status: 'queued' };
    expect(parseMessages({ messages: [message, { ...message, status: 'weird' }] })).toHaveLength(1);
    expect(parseFeed([{ id: 'f', agentId: 'a', agentName: 'A', projectId: 'p', activity }, { id: 'g' }])).toHaveLength(
      1,
    );
    expect(parseNotice({ id: 'n', at: 1, level: 'alert', text: 'x' })?.level).toBe('alert');
    expect(parseNotice({ id: 'n', at: 1, level: 'bogus', text: 'x' })).toBeNull();
    expect(
      parseSessions({ sessions: [{ sessionId: 's', accountId: 'a', lastAt: 1, projectName: 'p' }, {}] }),
    ).toHaveLength(1);
  });

  it('parses transcript pages defensively', () => {
    const page = parseTranscriptPage({
      entries: [
        { kind: 'user', at: 1, text: 'oi' },
        { kind: 'tool', at: 2, id: 't', name: 'Bash', summary: 's' },
        { kind: 'tool', at: 3 },
        { kind: 'zzz' },
      ],
      next: 2,
      open: false,
    });
    expect(page.entries).toHaveLength(2);
    expect(page.next).toBe(2);
    expect(page.open).toBe(false);
    expect(() => parseTranscriptPage(null)).toThrow();
  });

  it('parses day stats', () => {
    const day = parseDay({
      date: '2026-10-19',
      agents: [{ agentId: 'a', name: 'A', projectId: 'p', ms: { working: 1 } }, { agentId: 5 }],
    });
    expect(day.agents).toHaveLength(1);
    expect(() => parseDay('x')).toThrow();
  });
});
