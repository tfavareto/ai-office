import type { AgentStatus } from '@ai-office/shared';
/** A tool_use pending longer than this while the registry says idle means a permission prompt is open. */
export declare const PENDING_TOOL_WAIT_MS = 8000;
/** Transcript says "working" but nothing happened for this long while the registry says idle: the turn was cut. */
export declare const STALE_WORKING_MS = 15000;
/** Without a registry, a "working" turn with no events for this long is considered finished. */
export declare const STALE_WORKING_NO_REGISTRY_MS: number;
export interface StatusInput {
    now: number;
    turn: 'working' | 'idle';
    lastEventAt: number;
    /** Registry status ('busy', 'idle', 'waiting'...) when the session has a registry entry. */
    registryStatus?: string;
    registryStatusAt?: number;
    permissionPending: boolean;
    attentionMessage?: string;
    /** Text for a pending user-facing tool (question, plan approval). */
    pendingUserTool?: string;
    /** Oldest pending tool that normally finishes fast. */
    blockingTool?: {
        name: string;
        at: number;
    };
}
export interface DerivedStatus {
    status: Extract<AgentStatus, 'working' | 'waiting' | 'idle'>;
    waitingFor?: string;
}
export declare function deriveStatus(input: StatusInput): DerivedStatus;
