import { describe, expect, test } from 'vitest';
import { billableTokens, mergeUsage, priceFor, tokensIn, usageCostUSD } from '../claude/cost';
import type { UsageInfo } from '../claude/types';
import { UsageTracker, startOfDay, startOfWeek } from './usage';

const usage = (over: Partial<UsageInfo> = {}): UsageInfo => ({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...over });
const HOUR = 3_600_000;

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

describe('UsageTracker', () => {
  const now = new Date(2026, 9, 21, 15, 30).getTime(); // Wednesday 15:30 local
  const record = (at: number, tokens: number, id: string) => ({ messageId: id, at, model: 'claude-sonnet-5-5', usage: usage({ output: tokens }) });

  test('windows: 5 h block, week from Monday 00:00 and today', () => {
    const tracker = new UsageTracker();
    tracker.add('a', 's', record(now - 30 * HOUR, 100, 'old'));
    tracker.add('a', 's', record(startOfDay(now) + HOUR, 200, 'today-early'));
    tracker.add('a', 's', record(now - HOUR, 300, 'recent'));
    const [result] = tracker.compute(['a'], now);
    expect(result?.today.tokens).toBe(500);
    expect(result?.week.tokens).toBe(600);
    expect(result?.week.resetsAt).toBe(startOfWeek(now) + 7 * 24 * HOUR);
    expect(result?.window5h.tokens).toBe(300);
    expect(result?.window5h.resetsAt).toBeGreaterThan(now);
    expect(result?.window5h.resetsAt).toBeLessThanOrEqual(now + 5 * HOUR);
    expect(result?.week.costUSD).toBeGreaterThan(0);
  });

  test('the same message id is counted once (last numbers win)', () => {
    const tracker = new UsageTracker();
    tracker.add('a', 's', record(now - 1000, 10, 'm'));
    tracker.add('a', 's', record(now - 1000, 40, 'm'));
    expect(tracker.compute(['a'], now)[0]?.today.tokens).toBe(40);
  });

  test('an expired block leaves the window empty with a fresh reset time', () => {
    const tracker = new UsageTracker();
    tracker.add('a', 's', record(now - 8 * HOUR, 100, 'x'));
    const [result] = tracker.compute(['a'], now);
    expect(result?.window5h.tokens).toBe(0);
    expect(result?.window5h.resetsAt).toBe(now + 5 * HOUR);
  });

  test('a new block starts after the previous one expired', () => {
    const tracker = new UsageTracker();
    tracker.add('a', 's', record(now - 7 * HOUR, 100, 'first'));
    tracker.add('a', 's', record(now - 20 * 60_000, 50, 'second'));
    expect(tracker.compute(['a'], now)[0]?.window5h.tokens).toBe(50);
  });

  test('accounts without usage report zeros', () => {
    expect(new UsageTracker().compute(['z'], now)[0]).toMatchObject({ accountId: 'z', today: { tokens: 0, costUSD: 0 } });
  });
});
