import { describe, expect, it } from 'vitest';
import {
  MAX_ALIAS_LENGTH,
  MAX_CUSTOM_AGENTS,
  MAX_CUSTOM_ORDER,
  MAX_CUSTOMIZATION_BYTES,
  MAX_NAME_LENGTH,
  emptyCustomization,
} from './types';
import { checkAlias, checkName, isValidKey, readCustomization, readStoredCustomization } from './validate';

const doc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ version: 1, ...extra });

describe('checkName', () => {
  it('trims and collapses spaces', () => {
    expect(checkName('  Ana   Clara ')).toEqual({ ok: true, value: 'Ana Clara' });
  });

  it('refuses an empty name or one that is not text', () => {
    expect(checkName('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(checkName(42)).toEqual({ ok: false, reason: 'empty' });
  });

  it('refuses control characters and text direction overrides', () => {
    expect(checkName('Ana\u0007')).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(checkName('Ana\nBruno')).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(checkName('‮ana')).toEqual({ ok: false, reason: 'invalid-chars' });
    expect(checkName('a b')).toEqual({ ok: false, reason: 'invalid-chars' });
  });

  it('counts characters, not UTF-16 units', () => {
    expect(checkName('🙂'.repeat(MAX_NAME_LENGTH))).toMatchObject({ ok: true });
    expect(checkName('🙂'.repeat(MAX_NAME_LENGTH + 1))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('allows accents and normalizes them', () => {
    expect(checkName('José')).toEqual({ ok: true, value: 'José' });
  });
});

describe('checkAlias', () => {
  it('allows a longer text than a name', () => {
    expect(checkAlias('x'.repeat(MAX_ALIAS_LENGTH))).toMatchObject({ ok: true });
    expect(checkAlias('x'.repeat(MAX_ALIAS_LENGTH + 1))).toEqual({ ok: false, reason: 'too-long' });
  });
});

describe('isValidKey', () => {
  it('accepts folders and session ids', () => {
    expect(isValidKey('/Users/ana/projects/shop')).toBe(true);
    expect(isValidKey('acct|sess:agent1')).toBe(true);
  });

  it('refuses empty, huge, control and prototype keys', () => {
    expect(isValidKey('')).toBe(false);
    expect(isValidKey('x'.repeat(2000))).toBe(false);
    expect(isValidKey('a\u0000b')).toBe(false);
    expect(isValidKey('__proto__')).toBe(false);
  });
});

describe('readCustomization (strict)', () => {
  it('accepts a complete document and keeps it as it is', () => {
    const input = doc({
      agents: {
        'a|s': { name: 'Rô', look: { skin: 'tan', hairStyle: 2, hairColor: 'red', outfit: 'teal', accessory: 'cap' } },
      },
      rooms: {
        '/p/shop': {
          alias: 'Loja',
          theme: { color: '#AA00CC', floor: 'wood', wall: 'brick', plants: 'lush', sign: 'neon' },
          look: { outfit: 'azure' },
          pinned: true,
          hidden: true,
        },
      },
      accounts: { work: { look: { accessory: 'glasses' } } },
      order: ['/p/shop', '/p/api'],
    });
    const read = readCustomization(input, true);
    expect(read).toMatchObject({ ok: true, dropped: 0 });
    if (!read.ok) return;
    expect(read.value.rooms['/p/shop']?.theme?.color).toBe('#aa00cc');
    expect(read.value.agents['a|s']?.name).toBe('Rô');
    expect(read.value.order).toEqual(['/p/shop', '/p/api']);
  });

  it('reports the field of the first problem', () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [doc({ agents: { a: { name: '' } } }), 'invalid-name', 'agents.a.name'],
      [doc({ agents: { a: { look: { skin: 'green' } } } }), 'invalid-look', 'agents.a.look.skin'],
      [doc({ agents: { a: { look: { hairStyle: 4 } } } }), 'invalid-look', 'agents.a.look.hairStyle'],
      [doc({ agents: { a: { look: { hat: 'cap' } } } }), 'invalid-look', 'agents.a.look.hat'],
      [doc({ rooms: { r: { alias: 'a\u0001' } } }), 'invalid-alias', 'rooms.r.alias'],
      [doc({ rooms: { r: { theme: { color: 'red' } } } }), 'invalid-theme', 'rooms.r.theme.color'],
      [doc({ rooms: { r: { theme: { floor: 'lava' } } } }), 'invalid-theme', 'rooms.r.theme.floor'],
      [doc({ rooms: { r: { pinned: 'yes' } } }), 'invalid-body', 'rooms.r.pinned'],
      [doc({ rooms: { r: { colour: 1 } } }), 'invalid-body', 'rooms.r.colour'],
      [doc({ rooms: [] }), 'invalid-body', 'rooms'],
      [doc({ order: 'a' }), 'invalid-order', 'order'],
      [doc({ order: ['a', 'a'] }), 'invalid-order', 'order.1'],
    ];
    for (const [input, error, field] of cases)
      expect(readCustomization(input, true)).toEqual({ ok: false, error: { error, field } });
  });

  it('refuses a key that is not an id', () => {
    const input = JSON.parse('{"version":1,"agents":{"__proto__":{"name":"x"}}}') as unknown;
    expect(readCustomization(input, true)).toEqual({ ok: false, error: { error: 'invalid-key', field: 'agents' } });
  });

  it('refuses other versions and other shapes', () => {
    expect(readCustomization({ version: 2 }, true)).toMatchObject({
      ok: false,
      error: { error: 'unsupported-version' },
    });
    expect(readCustomization([], true)).toEqual({ ok: false, error: { error: 'invalid-body' } });
    expect(readCustomization(null, true)).toEqual({ ok: false, error: { error: 'invalid-body' } });
  });

  it('limits the number of agents and of ordered rooms', () => {
    const agents = Object.fromEntries(
      Array.from({ length: MAX_CUSTOM_AGENTS + 1 }, (_, i) => [`a${i}`, { name: 'x' }]),
    );
    expect(readCustomization(doc({ agents }), true)).toEqual({
      ok: false,
      error: { error: 'too-many-items', field: 'agents' },
    });
    const order = Array.from({ length: MAX_CUSTOM_ORDER + 1 }, (_, i) => `r${i}`);
    expect(readCustomization(doc({ order }), true)).toEqual({
      ok: false,
      error: { error: 'too-many-items', field: 'order' },
    });
  });

  it('limits the size of the document', () => {
    const rooms = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`/${'p'.repeat(1000)}${i}`, { alias: 'x'.repeat(40) }]),
    );
    expect(MAX_CUSTOMIZATION_BYTES).toBeLessThan(200 * 1040);
    expect(readCustomization(doc({ rooms }), true)).toEqual({ ok: false, error: { error: 'too-large' } });
  });

  it('prunes entries that say nothing', () => {
    const read = readCustomization(
      doc({ agents: { a: {} }, rooms: { r: { pinned: false, theme: {} } }, accounts: { x: {} } }),
      true,
    );
    expect(read).toMatchObject({ ok: true, value: emptyCustomization() });
  });
});

describe('readCustomization (lenient)', () => {
  it('drops what is wrong and keeps the rest', () => {
    const read = readCustomization(
      doc({
        agents: { good: { name: 'Ana' }, bad: { name: '' }, worse: 'x' },
        rooms: { r: { alias: 'Loja', theme: { floor: 'lava', color: '#112233' } } },
        order: ['r', 'r', 'q'],
      }),
      false,
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(Object.keys(read.value.agents)).toEqual(['good']);
    expect(read.value.rooms.r).toEqual({ alias: 'Loja', theme: { color: '#112233' } });
    expect(read.value.order).toEqual(['r', 'q']);
    expect(read.dropped).toBe(4);
  });

  it('keeps the newest agents when the file has too many', () => {
    const agents = Object.fromEntries(
      Array.from({ length: MAX_CUSTOM_AGENTS + 5 }, (_, i) => [`a${i}`, { name: 'x' }]),
    );
    const read = readCustomization(doc({ agents }), false);
    expect(read.ok && Object.keys(read.value.agents)).toHaveLength(MAX_CUSTOM_AGENTS);
    expect(read.ok && read.value.agents[`a${MAX_CUSTOM_AGENTS + 4}`]).toBeDefined();
    expect(read.ok && read.value.agents.a0).toBeUndefined();
  });
});

describe('readStoredCustomization', () => {
  it('treats a missing file as an empty customization', () => {
    expect(readStoredCustomization(undefined)).toEqual({ status: 'empty', value: emptyCustomization() });
  });

  it('reads a current document', () => {
    const outcome = readStoredCustomization(doc({ order: ['a'] }));
    expect(outcome).toMatchObject({ status: 'ok', value: { order: ['a'] }, dropped: 0 });
  });

  it('migrates a document written before versions existed', () => {
    const outcome = readStoredCustomization({ agents: { a: { name: 'Zé' } } });
    expect(outcome).toMatchObject({ status: 'migrated', value: { version: 1, agents: { a: { name: 'Zé' } } } });
  });

  it('leaves a document from a newer version alone', () => {
    expect(readStoredCustomization({ version: 9, agents: {} })).toEqual({ status: 'newer' });
  });

  it('rejects what is not a document', () => {
    expect(readStoredCustomization([])).toEqual({ status: 'invalid' });
    expect(readStoredCustomization('x')).toEqual({ status: 'invalid' });
    expect(readStoredCustomization({ version: 'one' })).toEqual({ status: 'invalid' });
    expect(readStoredCustomization({ version: -1 })).toEqual({ status: 'invalid' });
  });
});
