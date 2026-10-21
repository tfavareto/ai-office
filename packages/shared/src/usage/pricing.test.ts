import { describe, expect, test } from 'vitest';
import { modelFamily, modelLabel, priceFor, tokensCostUSD } from './pricing';

describe('price table', () => {
  test('finds the price by model family', () => {
    expect(priceFor('claude-opus-5-5')).toMatchObject({ input: 5, output: 25 });
    expect(priceFor('claude-opus-4-1-20250805')).toMatchObject({ input: 15, output: 75 });
    expect(priceFor('claude-sonnet-5-5')).toMatchObject({ input: 3, output: 15, cacheWrite5m: 3.75, cacheRead: 0.3 });
    expect(priceFor('claude-3-5-haiku-20241022')).toMatchObject({ input: 0.8 });
    expect(priceFor('mystery')).toBeUndefined();
  });

  test('prices the five counters of a message', () => {
    const tokens = {
      input: 1_000_000,
      output: 1_000_000,
      cacheWrite5m: 0,
      cacheWrite1h: 1_000_000,
      cacheRead: 1_000_000,
    };
    expect(tokensCostUSD('claude-sonnet-5-5', tokens)).toBeCloseTo(3 + 15 + 6 + 0.3, 6);
    expect(tokensCostUSD('mystery', tokens)).toBeUndefined();
  });
});

describe('model names', () => {
  test('classifies the family', () => {
    expect(modelFamily('claude-opus-5-5')).toBe('opus');
    expect(modelFamily('claude-3-5-haiku-20241022')).toBe('haiku');
    expect(modelFamily('gpt-x')).toBe('other');
  });

  test.each([
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-haiku-4-5', 'Haiku 4.5'],
    ['claude-opus-4-1-20250805', 'Opus 4.1'],
    ['claude-sonnet-4-20250514', 'Sonnet 4'],
    ['claude-3-5-haiku-20241022', 'Haiku 3.5'],
    ['claude-opus-5-5[1m]', 'Opus 5.5'],
    ['claude-fable', 'Fable'],
    ['some-other-model', 'some-other-model'],
  ])('shows %s as %s', (id, label) => {
    expect(modelLabel(id)).toBe(label);
  });
});
