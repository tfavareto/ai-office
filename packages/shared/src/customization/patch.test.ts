import { describe, expect, it } from 'vitest';
import { applyCustomizationPatch } from './patch';
import { MAX_CUSTOM_AGENTS, type Customization, emptyCustomization } from './types';

const base = (): Customization => ({
  ...emptyCustomization(),
  agents: { a: { name: 'Ana', look: { outfit: 'navy', skin: 'tan' } } },
  rooms: { '/p': { alias: 'Loja', pinned: true, theme: { floor: 'wood', color: '#112233' } } },
  order: ['/p', '/q'],
});

function value(patch: unknown, from = base()): Customization {
  const result = applyCustomizationPatch(from, patch);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe('applyCustomizationPatch', () => {
  it('merges the fields it names and keeps the others', () => {
    const next = value({ agents: { a: { look: { outfit: 'wine' } } } });
    expect(next.agents.a).toEqual({ name: 'Ana', look: { outfit: 'wine', skin: 'tan' } });
  });

  it('removes a field with null and an item once nothing is left of it', () => {
    expect(value({ agents: { a: { look: { skin: null } } } }).agents.a?.look).toEqual({ outfit: 'navy' });
    expect(value({ agents: { a: null } }).agents).toEqual({});
    expect(value({ agents: { a: { name: null, look: null } } }).agents).toEqual({});
  });

  it('adds new agents, rooms and accounts', () => {
    const next = value({
      agents: { b: { name: 'Bia' } },
      rooms: { '/q': { hidden: true } },
      accounts: { w: { look: { accessory: 'cap' } } },
    });
    expect(next.agents.b).toEqual({ name: 'Bia' });
    expect(next.rooms['/q']).toEqual({ hidden: true });
    expect(next.accounts.w).toEqual({ look: { accessory: 'cap' } });
  });

  it('replaces the order as a whole and clears it with null', () => {
    expect(value({ order: ['/q'] }).order).toEqual(['/q']);
    expect(value({ order: null }).order).toEqual([]);
  });

  it('clears a table with null', () => {
    expect(value({ rooms: null }).rooms).toEqual({});
  });

  it('turns a flag off with false or null', () => {
    expect(value({ rooms: { '/p': { pinned: false } } }).rooms['/p']?.pinned).toBeUndefined();
    expect(value({ rooms: { '/p': { pinned: null } } }).rooms['/p']?.pinned).toBeUndefined();
  });

  it('does not change the document it was given', () => {
    const before = base();
    value({ agents: { a: null }, order: [] }, before);
    expect(before).toEqual(base());
  });

  it('refuses what the document would not allow', () => {
    expect(applyCustomizationPatch(base(), { agents: { a: { name: '' } } })).toMatchObject({
      ok: false,
      error: { error: 'invalid-name' },
    });
    expect(applyCustomizationPatch(base(), { rooms: { '/p': { theme: { sign: 'gold' } } } })).toMatchObject({
      ok: false,
      error: { error: 'invalid-theme' },
    });
  });

  it('refuses a body that is not an object or names unknown parts', () => {
    expect(applyCustomizationPatch(base(), [])).toEqual({ ok: false, error: { error: 'invalid-body' } });
    expect(applyCustomizationPatch(base(), { colors: {} })).toEqual({
      ok: false,
      error: { error: 'invalid-body', field: 'colors' },
    });
  });

  it('ignores a version in the patch', () => {
    expect(value({ version: 7 }).version).toBe(1);
  });

  it('cannot reach the prototype through a key', () => {
    const patch = JSON.parse('{"agents":{"__proto__":{"polluted":true}}}') as unknown;
    expect(applyCustomizationPatch(base(), patch).ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops the oldest agents when a patch passes the cap', () => {
    const full: Customization = {
      ...emptyCustomization(),
      agents: Object.fromEntries(Array.from({ length: MAX_CUSTOM_AGENTS }, (_, i) => [`old${i}`, { name: 'x' }])),
    };
    const next = value({ agents: { fresh: { name: 'Nova' } } }, full);
    expect(Object.keys(next.agents)).toHaveLength(MAX_CUSTOM_AGENTS);
    expect(next.agents.fresh).toBeDefined();
    expect(next.agents.old0).toBeUndefined();
  });
});
