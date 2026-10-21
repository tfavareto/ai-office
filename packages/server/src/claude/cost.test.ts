import { describe, expect, test } from 'vitest';
import { billableTokens, mergeUsage, priceFor, tokensIn, usageCostUSD } from './cost';
import type { UsageInfo } from './types';

const usage = (over: Partial<UsageInfo> = {}): UsageInfo => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...over });

describe('cost', () => {
  test('price table by model family', () => {
    expect(priceFor('claude-opus-5-5')).toMatchObject({ input: 5, output: 25 });
    expect(priceFor('claude-opus-4-1-20250805')).toMatchObject({ input: 15, output: 75 });
    expect(priceFor('claude-sonnet-5-5')).toMatchObject({ input: 3, output: 15, cacheWrite5m: 3.75, cacheRead: 0.3 });
    expect(priceFor('claude-haiku-4-5')).toMatchObject({ input: 1, output: 5 });
    expect(priceFor('claude-3-5-haiku-20241022')).toMatchObject({ input: 0.8 });
    expect(priceFor('fable-1')).toBeDefined();
    expect(priceFor('gpt-x')).toBeUndefined();
    expect(priceFor(undefined)).toBeUndefined();
  });

  test('cost of a message, token helpers and usage merge', () => {
    const sonnet = usage({ input: 1_000_000, output: 1_000_000, cacheWrite1h: 1_000_000, cacheRead: 1_000_000 });
    expect(usageCostUSD('claude-sonnet-5-5', sonnet)).toBeCloseTo(3 + 15 + 6 + 0.3, 6);
    expect(usageCostUSD('mystery', sonnet)).toBeUndefined();
    expect(billableTokens(sonnet)).toBe(3_000_000);
    expect(tokensIn(sonnet)).toBe(2_000_000);
    expect(mergeUsage(usage({ input: 1, output: 9 }), usage({ input: 5, output: 2 }))).toEqual(usage({ input: 5, output: 9 }));
  });
});
