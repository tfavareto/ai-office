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

describe('OpenAI price table (Codex)', () => {
  test('finds the price of the Codex models by id', () => {
    expect(priceFor('gpt-5.6-sol')).toMatchObject({ input: 4, output: 20, cacheRead: 0.4 });
    expect(priceFor('gpt-6-astra')).toMatchObject({ input: 10, output: 50, cacheRead: 1 });
    expect(priceFor('GPT-5.3-Codex')).toMatchObject({ input: 1.75, output: 14 });
  });

  test('does not mistake a pro or dated variant for the base model', () => {
    expect(priceFor('gpt-5.5-pro')).toMatchObject({ input: 30, output: 180 });
    expect(priceFor('gpt-5.5-2026-08-01')).toMatchObject({ input: 5, output: 30 });
    expect(priceFor('gpt-5')).toMatchObject({ input: 1.25 });
  });

  test('has no price for a model it does not know', () => {
    expect(priceFor('codex-auto-review')).toBeUndefined();
    expect(priceFor('gpt-9-unknown')).toBeUndefined();
  });

  test('prices cached input at the cache read price and writes as plain input', () => {
    const tokens = {
      input: 1_000_000,
      output: 1_000_000,
      cacheWrite5m: 1_000_000,
      cacheWrite1h: 0,
      cacheRead: 1_000_000,
    };
    expect(tokensCostUSD('gpt-5.6-sol', tokens)).toBeCloseTo(4 + 20 + 4 + 0.4, 6);
  });

  test('keeps OpenAI ids as they are in labels', () => {
    expect(modelLabel('gpt-5.6-sol')).toBe('gpt-5.6-sol');
  });
});

describe('model names', () => {
  test('classifies the family', () => {
    expect(modelFamily('claude-opus-5-5')).toBe('opus');
    expect(modelFamily('claude-3-5-haiku-20241022')).toBe('haiku');
    expect(modelFamily('gpt-5.6-sol')).toBe('gpt');
    expect(modelFamily('codex-auto-review')).toBe('gpt');
    expect(modelFamily('mystery')).toBe('other');
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
