import type { AgentStats } from '@ai-office/shared';
import type { UsageInfo } from './types';
export declare class StatsAccumulator {
    private readonly messages;
    private toolCalls;
    private linesAdded;
    private linesRemoved;
    private baseline;
    private tokensInTotal;
    private tokensOutTotal;
    private costTotal;
    private hasCost;
    countToolCall(): void;
    addLines(added: number, removed: number): void;
    /** A `cost-state` line carries session totals: use them as the new baseline and restart the local sums. */
    setBaseline(costUSD: number, linesAdded: number, linesRemoved: number): void;
    /**
     * Registers the usage of a message. Repeated lines of the same message keep the field-wise maximum.
     * Returns the usage that should be counted globally (the merged record).
     */
    addUsage(messageId: string | undefined, model: string | undefined, usage: UsageInfo): UsageInfo;
    private add;
    private remove;
    snapshot(subagents: number): AgentStats;
}
