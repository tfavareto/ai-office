// Cost estimates from public API list prices (the table lives in the shared package). Always an estimate.
import { type ModelPrice, priceFor, tokensCostUSD } from '@ai-office/shared';
import type { UsageInfo } from './types';

export { type ModelPrice, priceFor };

/** Estimated cost in USD of one message, or undefined when the model has no known price. */
export function usageCostUSD(model: string | undefined, usage: UsageInfo): number | undefined {
  return tokensCostUSD(model, usage);
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
