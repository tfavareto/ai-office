import { describe, expect, it } from 'vitest';
import type { Agent, Project } from '../model';
import { applyCustomization } from './apply';
import { emptyCustomization, type Customization } from './types';

function agent(id: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    kind: 'main',
    sessionId: id,
    accountId: 'acc',
    projectId: '/p',
    name: `Auto ${id}`,
    role: 'Principal',
    look: 'f',
    seed: 1,
    status: 'idle',
    statusSince: 0,
    recent: [],
    tasks: [],
    shells: [],
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 },
    startedAt: 0,
    lastEventAt: 0,
    ...over,
  };
}

const project = (id: string, order: number): Project => ({ id, name: id.slice(1), path: id, seed: order, order });

function custom(over: Partial<Customization>): Customization {
  return { ...emptyCustomization(), ...over };
}

describe('applyCustomization', () => {
  it('returns the same objects when nothing is customized', () => {
    const office = { projects: [project('/p', 0)], agents: [agent('a')] };
    expect(applyCustomization(office, emptyCustomization())).toBe(office);
  });

  it('renames an agent and remembers the name the office gave', () => {
    const out = applyCustomization(
      { projects: [], agents: [agent('a'), agent('b')] },
      custom({ agents: { a: { name: 'Rô' } } }),
    );
    expect(out.agents[0]).toMatchObject({ name: 'Rô', defaultName: 'Auto a' });
    expect(out.agents[1]).toEqual(agent('b'));
  });

  it('keeps the agents it did not touch as they were', () => {
    const untouched = agent('b');
    const out = applyCustomization(
      { projects: [], agents: [agent('a'), untouched] },
      custom({ agents: { a: { name: 'Rô' } } }),
    );
    expect(out.agents[1]).toBe(untouched);
  });

  it('resolves the look field by field: agent, then room, then account', () => {
    const c = custom({
      agents: { a: { look: { outfit: 'wine' } } },
      rooms: { '/p': { look: { outfit: 'teal', accessory: 'cap' } } },
      accounts: { acc: { look: { accessory: 'glasses', skin: 'deep' } } },
    });
    const out = applyCustomization({ projects: [], agents: [agent('a')] }, c);
    expect(out.agents[0]?.appearance).toEqual({ skin: 'deep', outfit: 'wine', accessory: 'cap' });
  });

  it('gives a subagent the team defaults of its main agent, unless it has its own', () => {
    const main = agent('m');
    const sub = agent('s', { kind: 'sub', parentId: 'm' });
    const own = agent('o', { kind: 'sub', parentId: 'm' });
    const c = custom({
      rooms: { '/p': { look: { outfit: 'teal' } } },
      agents: { o: { look: { outfit: 'wine' } }, m: { look: { outfit: 'gold' } } },
    });
    const out = applyCustomization({ projects: [], agents: [main, sub, own] }, c);
    expect(out.agents[0]?.appearance?.outfit).toBe('gold');
    expect(out.agents[1]?.appearance?.outfit).toBe('teal');
    expect(out.agents[2]?.appearance?.outfit).toBe('wine');
  });

  it('uses the room and account of the main agent for its subagents', () => {
    const main = agent('m', { projectId: '/team', accountId: 'work' });
    const sub = agent('s', { kind: 'sub', parentId: 'm', projectId: '/elsewhere', accountId: 'other' });
    const c = custom({
      rooms: { '/team': { look: { outfit: 'azure' } } },
      accounts: { work: { look: { skin: 'tan' } } },
    });
    expect(applyCustomization({ projects: [], agents: [main, sub] }, c).agents[1]?.appearance).toEqual({
      outfit: 'azure',
      skin: 'tan',
    });
  });

  it('shows a room alias, theme and flags and keeps the folder name', () => {
    const c = custom({
      rooms: { '/p': { alias: 'Loja', theme: { floor: 'wood' }, pinned: true, hidden: true } },
      order: ['/q', '/p'],
    });
    const out = applyCustomization({ projects: [project('/p', 0), project('/q', 1), project('/z', 2)], agents: [] }, c);
    expect(out.projects[0]).toMatchObject({
      id: '/p',
      name: 'Loja',
      originalName: 'p',
      theme: { floor: 'wood' },
      pinned: true,
      hidden: true,
      rank: 1,
    });
    expect(out.projects[1]).toMatchObject({ id: '/q', name: 'q', rank: 0 });
    expect(out.projects[2]).toEqual(project('/z', 2));
  });
});

describe('applyCustomization over an office that is already customized (the demo)', () => {
  it('keeps what the first layer chose and puts the person choices on top, field by field', () => {
    const first = applyCustomization(
      { projects: [project('/p', 0)], agents: [agent('a')] },
      custom({
        rooms: { '/p': { alias: 'Demo', theme: { floor: 'wood', sign: 'neon' } } },
        agents: { a: { name: 'Nova', look: { accessory: 'cap', skin: 'tan' } } },
      }),
    );
    const second = applyCustomization(
      first,
      custom({ rooms: { '/p': { theme: { floor: 'tiles' } } }, agents: { a: { look: { skin: 'deep' } } } }),
    );
    expect(second.projects[0]?.theme).toEqual({ floor: 'tiles', sign: 'neon' });
    expect(second.projects[0]?.name).toBe('Demo');
    expect(second.agents[0]?.appearance).toEqual({ accessory: 'cap', skin: 'deep' });
    expect(second.agents[0]?.name).toBe('Nova');
  });
});
