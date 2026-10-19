import type { Activity } from '@ai-office/shared';
export type BubbleMode = 'all' | 'important' | 'none';
export type Liveliness = 'calm' | 'normal' | 'lively';
export interface BubbleCandidate {
    agentId: string;
    /** Area the agent is in (the per-room cap uses it). */
    roomId: string;
    text: string;
    icon: string;
    importance: number;
    /** Stays until replaced or withdrawn (alerts). */
    sticky: boolean;
    /** Seconds on screen for non-sticky bubbles. */
    ttl: number;
}
export interface Bubble extends BubbleCandidate {
    /** Sim time (s) when the bubble became visible; fades are computed from it. */
    shownAt: number;
    /** Sim time (s) after which it disappears (Infinity when sticky). */
    endsAt: number;
}
export declare const IMPORTANT_THRESHOLD = 55;
export declare const ALERT_IMPORTANCE = 100;
export declare function activityImportance(activity: Activity): number;
export declare function clipText(text: string, max?: number): string;
/**
 * Speech-bubble queue with rationing: a bubble per agent at most, a cap per room and a cap overall; higher importance
 * wins, then recency. Pure and deterministic (driven only by the times it is given).
 */
export declare class BubbleManager {
    private pending;
    private visible;
    private lastShown;
    private mode;
    private liveliness;
    configure(mode: BubbleMode, liveliness: Liveliness): void;
    /** Offer a bubble for an agent; it replaces that agent's pending/visible bubble when at least as important. */
    offer(candidate: BubbleCandidate, now: number): void;
    /** Remove everything of an agent (it left, or its alert was answered). */
    withdraw(agentId: string): void;
    /** Remove only a sticky bubble (alert answered) keeping normal ones. */
    withdrawSticky(agentId: string): void;
    update(now: number, roomOf: (agentId: string) => string | null): readonly Bubble[];
    current(): readonly Bubble[];
    private countInRoom;
    private allows;
}
