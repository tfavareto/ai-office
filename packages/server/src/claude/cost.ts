// Cost estimates from public API list prices, per model family. Always an estimate (plans bill differently).
import type { UsageInfo } from './types';

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

function price(input: number, output: number): ModelPrice {
  return { input, output, cacheWrite5m: round(input * 1.25), cacheWrite1h: round(input * 2), cacheRead: round(input * 0.1) };
}

const OPUS_LEGACY = price(15, 75);
const OPUS = price(5, 25);
const SONNET = price(3, 15);
const HAIKU = price(1, 5);
const HAIKU_LEGACY = price(0.8, 4);
/** Fable is priced like the current Opus tier (estimate). */
const FABLE = OPUS;

/** Price table lookup by model id ("claude-opus-5-5", "claude-3-5-haiku-20241022"...). */
export function priceFor(model: string | undefined): ModelPrice | undefined {
  if (model === undefined) return undefined;
  const id = model.toLowerCase();
  if (id.includes('opus')) {
    return /opus-4(-1)?(-\d{8})?$/.test(id) || id.includes('3-opus') || id.includes('opus-3') ? OPUS_LEGACY : OPUS;
  }
  if (id.includes('sonnet')) return SONNET;
  if (id.includes('haiku')) return /3-5-haiku|haiku-3/.test(id) ? HAIKU_LEGACY : HAIKU;
  if (id.includes('fable')) return FABLE;
  return undefined;
}

/** Estimated cost in USD of one message, or undefined when the model has no known price. */
export function usageCostUSD(model: string | undefined, usage: UsageInfo): number | undefined {
  const table = priceFor(model);
  if (table === undefined) return undefined;
  const million = 1_000_000;
  return (
    (usage.input * table.input +
      usage.output * table.output +
      usage.cacheWrite5m * table.cacheWrite5m +
      usage.cacheWrite1h * table.cacheWrite1h +
      usage.cacheRead * table.cacheRead) /
    million
  );
}

/** Tokens that count towards "tokens used": fresh input, cache writes and output (cache reads are excluded). */
export function billableTokens(usage: UsageInfo): number {
  return usage.input + usage.output + usage.cacheWrite5m + usage.cacheWrite1h;
}

export function tokensIn(usage: UsageInfo): number {
  return usage.input + usage.cacheWrite5m + usage.cacheWrite1h;
}

/** Field-wise maximum: streamed assistant lines repeat the usage of one message, keep the final numbers. */
export function mergeUsage(a: UsageInfo, b: UsageInfo): UsageInfo {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheWrite5m: Math.max(a.cacheWrite5m, b.cacheWrite5m),
    cacheWrite1h: Math.max(a.cacheWrite1h, b.cacheWrite1h),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
  };
}
