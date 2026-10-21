import { describe, expect, it } from 'vitest';
import type { UsageTotals } from '@ai-office/shared';
import { TOKEN_FIELD_SCALE, limitToInput, parseLimitInput, withLimit, withUnit, withoutLimits } from './usage-limits';
import { kpisOf, pickerAccounts, relativeChange, resolveAccount, sessionLabel, shareOf } from './usage-view';

const totals = (over: Partial<UsageTotals> = {}): UsageTotals => ({
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  tokens: 0,
  costUSD: 0,
  ...over,
});

describe('relativeChange and kpisOf', () => {
  it('compares with the previous period and has nothing to compare with an empty one', () => {
    expect(relativeChange(150, 100)).toBe(0.5);
    expect(relativeChange(50, 100)).toBe(-0.5);
    expect(relativeChange(10, 0)).toBeUndefined();
  });

  it('builds the tiles: totals, changes and the cache share', () => {
    // Arrange
    const current = totals({ input: 100, output: 50, cacheWrite: 100, cacheRead: 800, tokens: 250, costUSD: 3 });
    const previous = totals({ tokens: 200, costUSD: 4 });
    // Act
    const kpis = kpisOf({ totals: current, previous });
    // Assert
    expect(kpis).toMatchObject({ tokens: 250, costUSD: 3, tokensChange: 0.25, costChange: -0.25, hasData: true });
    expect(kpis.cacheHit).toBeCloseTo(0.8);
  });

  it('knows when there is no data', () => {
    expect(kpisOf({ totals: totals(), previous: totals() })).toMatchObject({
      hasData: false,
      tokensChange: undefined,
      cacheHit: 0,
    });
  });
});

describe('shares and labels', () => {
  it('shares are bounded and safe for an empty whole', () => {
    expect(shareOf({ tokens: 25 }, { tokens: 100 })).toBe(0.25);
    expect(shareOf({ tokens: 25 }, { tokens: 0 })).toBe(0);
    expect(shareOf({ tokens: 500 }, { tokens: 100 })).toBe(1);
  });

  it('labels a session by its title or a short id', () => {
    expect(sessionLabel({ session: 'abcdef123456', title: undefined }, '  Corrigir o bug ')).toEqual({
      title: 'Corrigir o bug',
      shortId: 'abcdef12',
      isSub: false,
    });
    expect(sessionLabel({ session: 'abcdef123456', agent: 'ag7', title: undefined }, undefined)).toEqual({
      title: undefined,
      shortId: 'ag7',
      isSub: true,
    });
    expect(sessionLabel({ session: 's', title: 'Pt' }, undefined).title).toBe('Pt');
  });

  it('offers "all" only with several accounts and keeps a valid choice', () => {
    expect(pickerAccounts(['a'])).toEqual(['a']);
    expect(pickerAccounts(['a', 'b'])).toEqual(['all', 'a', 'b']);
    expect(resolveAccount('b', ['a', 'b'])).toBe('b');
    expect(resolveAccount('gone', ['a', 'b'])).toBe('all');
    expect(resolveAccount('all', ['a'])).toBe('a');
    expect(resolveAccount('all', [])).toBe('all');
  });
});

describe('limits form', () => {
  it('parses typed amounts with either decimal separator', () => {
    expect(parseLimitInput('40', 'usd')).toEqual({ kind: 'value', value: 40 });
    expect(parseLimitInput(' 12,5 ', 'usd')).toEqual({ kind: 'value', value: 12.5 });
    expect(parseLimitInput('2', 'tokens')).toEqual({ kind: 'value', value: 2 * TOKEN_FIELD_SCALE });
    expect(parseLimitInput('', 'usd')).toEqual({ kind: 'empty' });
  });

  it.each(['0', '-3', 'abc', '1e9999', '12,3,4', '5 usd', '1000000000000'])('rejects %s', (text) => {
    expect(parseLimitInput(text, 'usd')).toEqual({ kind: 'invalid' });
  });

  it('shows stored values the way they are typed', () => {
    expect(limitToInput(undefined, 'usd')).toBe('');
    expect(limitToInput(40, 'usd')).toBe('40');
    expect(limitToInput(2_500_000, 'tokens')).toBe('2.5');
  });

  it('updates the saved limits without mutating them', () => {
    // Arrange
    const saved = Object.freeze({ a: Object.freeze({ unit: 'usd' as const, window5h: 10 }) });
    // Act
    const withWeek = withLimit(saved, 'a', 'week', 100);
    const cleared = withLimit(withWeek, 'a', 'window5h', undefined);
    const gone = withLimit(cleared, 'a', 'week', undefined);
    // Assert
    expect(saved).toEqual({ a: { unit: 'usd', window5h: 10 } });
    expect(withWeek).toEqual({ a: { unit: 'usd', window5h: 10, week: 100 } });
    expect(cleared).toEqual({ a: { unit: 'usd', week: 100 } });
    expect(gone).toEqual({});
  });

  it('a unit change clears the values, and tokens stay saved as a preference', () => {
    const saved = { a: { unit: 'usd' as const, window5h: 10 } };
    expect(withUnit(saved, 'a', 'tokens')).toEqual({ a: { unit: 'tokens' } });
    expect(withUnit(saved, 'a', 'usd')).toBe(saved);
    expect(withUnit({ a: { unit: 'tokens' as const } }, 'a', 'usd')).toEqual({});
    expect(withoutLimits(saved, 'a')).toEqual({});
  });
});
