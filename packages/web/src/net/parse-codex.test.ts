import { describe, expect, it } from 'vitest';
import { normalizeAccount, parseCodexSettings, parseSource, withValidSource } from './parse-codex';
import { agent } from '../test/fixtures';

describe('parseCodexSettings', () => {
  it('reads the three flags', () => {
    expect(parseCodexSettings({ sessions: true, available: true, locked: false })).toEqual({
      sessions: true,
      available: true,
      locked: false,
    });
  });

  it('treats missing flags as off', () => {
    expect(parseCodexSettings({ sessions: false })).toEqual({ sessions: false, available: false, locked: false });
  });

  it.each([[null], [{}], [{ sessions: 'yes' }], ['x']])('rejects %j', (data) => {
    expect(() => parseCodexSettings(data)).toThrow();
  });
});

describe('sources', () => {
  it('knows codex and nothing else', () => {
    expect(parseSource('codex')).toBe('codex');
    expect(parseSource('claude')).toBeUndefined();
    expect(parseSource(3)).toBeUndefined();
  });

  it('keeps a valid source on an account and drops an invalid one', () => {
    expect(normalizeAccount({ id: 'a', source: 'codex' })).toMatchObject({ source: 'codex' });
    expect(normalizeAccount({ id: 'a', source: 'x' })).not.toHaveProperty('source');
  });

  it('keeps a valid source on an agent', () => {
    expect(withValidSource(agent({ source: 'codex' })).source).toBe('codex');
    expect(withValidSource({ ...agent(), source: 'x' } as never)).not.toHaveProperty('source');
  });
});
