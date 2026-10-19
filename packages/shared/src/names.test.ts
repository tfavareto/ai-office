import { describe, expect, test } from 'vitest';
import { NAMES, findPerson, pickName } from './names';

describe('names', () => {
  test('has about 120 unique names with both looks', () => {
    expect(NAMES.length).toBeGreaterThanOrEqual(120);
    expect(new Set(NAMES.map((n) => n.name)).size).toBe(NAMES.length);
    expect(NAMES.some((n) => n.look === 'f')).toBe(true);
    expect(NAMES.some((n) => n.look === 'm')).toBe(true);
  });

  test('picks deterministically for the same key', () => {
    expect(pickName('conta:sessao', new Set())).toEqual(pickName('conta:sessao', new Set()));
  });

  test('avoids names that are already taken', () => {
    const first = pickName('chave', new Set());
    const second = pickName('chave', new Set([first.name]));
    expect(second.name).not.toBe(first.name);
  });

  test('keeps names unique even when every name is taken', () => {
    const taken = new Set(NAMES.map((n) => n.name));
    const extra = pickName('chave', taken);
    expect(taken.has(extra.name)).toBe(false);
    expect(extra.name).toMatch(/ 2$/);
  });

  test('recovers the look of a known name', () => {
    expect(findPerson('Ana')?.look).toBe('f');
    expect(findPerson('Bruno')?.look).toBe('m');
    expect(findPerson('Inexistente')).toBeUndefined();
  });
});
