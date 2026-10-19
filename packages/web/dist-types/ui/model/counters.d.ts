import type { Agent, OfficeSnapshot } from '@ai-office/shared';
export interface Counters {
    rooms: number;
    agents: number;
    working: number;
    subagents: number;
    shells: number;
    needsYou: number;
}
export declare const EMPTY_COUNTERS: Counters;
export declare function computeCounters(snapshot: OfficeSnapshot | null): Counters;
/** Agents that need the user, permission requests first, then oldest waiting first. */
export declare function agentsNeedingYou(agents: readonly Agent[]): Agent[];
export declare function agentsWithPermission(agents: readonly Agent[]): Agent[];
/** Agents running shells, the longest running first. */
export declare function agentsWithShells(agents: readonly Agent[]): Agent[];
/** The item after `currentId` in a cyclic list (the first one when current is absent). */
export declare function nextAfter<T extends {
    id: string;
}>(items: readonly T[], currentId: string | null): T | undefined;
