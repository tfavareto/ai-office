import type { UsageInfo } from './types';
/** USD per million tokens. */
export interface ModelPrice {
    input: number;
    output: number;
    cacheWrite5m: number;
    cacheWrite1h: number;
    cacheRead: number;
}
/** Price table lookup by model id ("claude-opus-5-5", "claude-3-5-haiku-20241022"...). */
export declare function priceFor(model: string | undefined): ModelPrice | undefined;
/** Estimated cost in USD of one message, or undefined when the model has no known price. */
export declare function usageCostUSD(model: string | undefined, usage: UsageInfo): number | undefined;
/** Tokens that count towards "tokens used": fresh input, cache writes and output (cache reads are excluded). */
export declare function billableTokens(usage: UsageInfo): number;
export declare function tokensIn(usage: UsageInfo): number;
/** Field-wise maximum: streamed assistant lines repeat the usage of one message, keep the final numbers. */
export declare function mergeUsage(a: UsageInfo, b: UsageInfo): UsageInfo;
