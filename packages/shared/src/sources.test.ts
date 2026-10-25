import { describe, expect, test } from 'vitest';
import { CODEX_ACCOUNT_ID, CODEX_COLOR, CODEX_LABEL, isCodex, sourceOf } from './sources';

describe('session sources', () => {
  test('a session without a source is Claude Code', () => {
    expect(isCodex({})).toBe(false);
    expect(isCodex(undefined)).toBe(false);
    expect(sourceOf({})).toBe('claude');
    expect(sourceOf(undefined)).toBe('claude');
  });

  test('a Codex session says so', () => {
    expect(isCodex({ source: 'codex' })).toBe(true);
    expect(sourceOf({ source: 'codex' })).toBe('codex');
    expect(isCodex({ source: 'claude' })).toBe(false);
  });

  test('the Codex account has a stable identity', () => {
    expect(CODEX_ACCOUNT_ID).toBe('codex');
    expect(CODEX_LABEL).toBe('Codex');
    expect(CODEX_COLOR).toMatch(/^#[0-9a-f]{6}$/);
  });
});
