import { describe, expect, it } from 'vitest';
import { applyCustomizationPatch, emptyCustomization, type Customization } from '@ai-office/shared';
import { agent, project, snapshot } from '../../test/fixtures';
import {
  agentDraft,
  agentPatch,
  aliasProblem,
  customizationCount,
  customizedItems,
  nameProblem,
  previewLook,
  resetPatch,
  roomDraft,
  roomPatch,
} from './customize';

function applied(base: Customization, patch: object | null): Customization {
  if (patch === null) return base;
  const result = applyCustomizationPatch(base, patch);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const main = agent({ id: 'm', projectId: '/p', accountId: 'acc', name: 'Ana' });
const sub = agent({ id: 's', kind: 'sub', parentId: 'm', projectId: '/p', accountId: 'acc', name: 'Bia' });
const agents = [main, sub];

describe('agent drafts', () => {
  it('starts from what is stored for the scope', () => {
    const custom = applied(emptyCustomization(), {
      agents: { m: { name: 'Capitã', look: { skin: 'tan' } } },
      rooms: { '/p': { look: { outfit: 'teal' } } },
    });
    expect(agentDraft(custom, main, agents, 'agent')).toEqual({
      name: 'Capitã',
      scope: 'agent',
      look: { skin: 'tan' },
    });
    expect(agentDraft(custom, main, agents, 'room').look).toEqual({ outfit: 'teal' });
    expect(agentDraft(custom, main, agents, 'account').look).toEqual({});
  });

  it('reads the team scopes of a subagent from its main agent', () => {
    const custom = applied(emptyCustomization(), { rooms: { '/p': { look: { outfit: 'teal' } } } });
    expect(agentDraft(custom, sub, agents, 'room').look).toEqual({ outfit: 'teal' });
  });

  it('saves nothing when nothing changed', () => {
    const custom = emptyCustomization();
    expect(agentPatch(custom, main, agents, agentDraft(custom, main, agents, 'agent'))).toBeNull();
  });

  it('saves a name and a look for the agent, and removes them when cleared', () => {
    const custom = emptyCustomization();
    const draft = { name: '  Capitã  ', scope: 'agent' as const, look: { outfit: 'wine' as const } };
    const saved = applied(custom, agentPatch(custom, main, agents, draft));
    expect(saved.agents.m).toEqual({ name: 'Capitã', look: { outfit: 'wine' } });
    const cleared = applied(saved, agentPatch(saved, main, agents, { name: '', scope: 'agent', look: {} }));
    expect(cleared.agents).toEqual({});
  });

  it('saves a look for the whole room or account without touching the name', () => {
    const custom = emptyCustomization();
    const forRoom = applied(
      custom,
      agentPatch(custom, main, agents, { name: '', scope: 'room', look: { outfit: 'azure' } }),
    );
    expect(forRoom.rooms['/p']?.look).toEqual({ outfit: 'azure' });
    expect(forRoom.agents).toEqual({});
    const forAccount = applied(
      custom,
      agentPatch(custom, sub, agents, { name: '', scope: 'account', look: { accessory: 'cap' } }),
    );
    expect(forAccount.accounts.acc?.look).toEqual({ accessory: 'cap' });
  });

  it('keeps the name change when the look goes to the team', () => {
    const custom = emptyCustomization();
    const saved = applied(
      custom,
      agentPatch(custom, main, agents, { name: 'Rô', scope: 'room', look: { outfit: 'azure' } }),
    );
    expect(saved.agents.m).toEqual({ name: 'Rô' });
    expect(saved.rooms['/p']?.look).toEqual({ outfit: 'azure' });
  });

  it('shows the look the draft would give, over the other layers', () => {
    const custom = applied(emptyCustomization(), {
      agents: { m: { look: { outfit: 'wine', skin: 'tan' } } },
      accounts: { acc: { look: { accessory: 'cap', skin: 'deep' } } },
    });
    const draft = { name: '', scope: 'room' as const, look: { outfit: 'azure' as const } };
    expect(previewLook(custom, main, agents, draft)).toEqual({ outfit: 'wine', skin: 'tan', accessory: 'cap' });
    const sameScope = { name: '', scope: 'agent' as const, look: { skin: 'fair' as const } };
    expect(previewLook(custom, main, agents, sameScope)).toEqual({ skin: 'fair', accessory: 'cap' });
    expect(previewLook(custom, sub, agents, draft)).toEqual({ outfit: 'azure', accessory: 'cap', skin: 'deep' });
  });
});

describe('names and aliases', () => {
  it('allows an empty name and explains the other problems', () => {
    expect(nameProblem('')).toBeNull();
    expect(nameProblem('  ')).toBeNull();
    expect(nameProblem('Ana')).toBeNull();
    expect(nameProblem('x'.repeat(40))).toBe('too-long');
    expect(nameProblem('a\u0000')).toBe('invalid-chars');
    expect(aliasProblem('x'.repeat(41))).toBe('too-long');
    expect(aliasProblem('x'.repeat(40))).toBeNull();
  });
});

describe('room drafts', () => {
  const room = project({ id: '/p', name: 'p' });

  it('turns every change into a patch and every cleared choice into null', () => {
    const custom = emptyCustomization();
    const saved = applied(
      custom,
      roomPatch(custom, room, {
        alias: 'Loja',
        theme: { color: '#37b27a', floor: 'wood', plants: 'lush' },
        teamOutfit: 'teal',
        pinned: true,
        hidden: false,
      }),
    );
    expect(saved.rooms['/p']).toEqual({
      alias: 'Loja',
      theme: { color: '#37b27a', floor: 'wood', plants: 'lush' },
      look: { outfit: 'teal' },
      pinned: true,
    });
    const draft = roomDraft(saved, room);
    expect(draft).toMatchObject({ alias: 'Loja', teamOutfit: 'teal', pinned: true, hidden: false });
    const back = applied(
      saved,
      roomPatch(saved, room, {
        alias: '',
        theme: { floor: 'wood' },
        teamOutfit: undefined,
        pinned: false,
        hidden: true,
      }),
    );
    expect(back.rooms['/p']).toEqual({ theme: { floor: 'wood' }, hidden: true });
  });

  it('saves nothing when the draft is what is stored', () => {
    const custom = applied(emptyCustomization(), { rooms: { '/p': { alias: 'Loja' } } });
    expect(roomPatch(custom, room, roomDraft(custom, room))).toBeNull();
  });
});

describe('the manager list', () => {
  it('lists rooms, agents and accounts with what changed, agents of the office first', () => {
    const custom = applied(emptyCustomization(), {
      rooms: { '/p': { alias: 'Loja', pinned: true, theme: { floor: 'wood' } }, '/gone': { hidden: true } },
      agents: { old: { name: 'Antigo' }, m: { look: { skin: 'tan' } } },
      accounts: { acc: { look: { outfit: 'navy' } } },
      order: ['/p'],
    });
    const items = customizedItems(
      custom,
      snapshot({
        projects: [project({ id: '/p', name: 'Loja', originalName: 'p' })],
        agents,
        accounts: [{ id: 'acc', label: 'Pessoal', initial: 'P', color: '#fff', dir: '' }],
      }),
      '?',
    );
    expect(items.map((i) => [i.kind, i.id, i.label])).toEqual([
      ['room', '/p', 'Loja'],
      ['room', '/gone', 'gone'],
      ['agent', 'm', 'Ana'],
      ['agent', 'old', 'Antigo'],
      ['account', 'acc', 'Pessoal'],
    ]);
    expect(items[0]?.changes).toEqual(['alias', 'theme', 'pinned']);
    expect(customizationCount(custom)).toBe(6);
    expect(customizationCount(emptyCustomization())).toBe(0);
  });

  it('resets one entry', () => {
    const custom = applied(emptyCustomization(), { agents: { m: { name: 'x' } }, rooms: { '/p': { pinned: true } } });
    const next = applied(custom, resetPatch('agents', 'm'));
    expect(next.agents).toEqual({});
    expect(next.rooms['/p']).toBeDefined();
  });
});
