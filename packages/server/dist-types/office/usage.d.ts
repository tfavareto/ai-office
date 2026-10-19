import type { AccountUsage } from '@ai-office/shared';
import type { UsageRecord } from '../claude/transcript-state';
/** Monday 00:00 local time of the week containing `at`. */
export declare function startOfWeek(at: number): number;
export declare function startOfDay(at: number): number;
export declare class UsageTracker {
    private readonly samples;
    private added;
    /** Registers one assistant message; the same message id is only counted once (the latest numbers win). */
    add(accountId: string, scope: string, record: UsageRecord): void;
    private prune;
    compute(accountIds: readonly string[], now: number): AccountUsage[];
    private computeFor;
    /** Start of the active 5 h block (blocks open at the first message after the previous one expired). */
    private currentBlock;
}
