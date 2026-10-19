import type { PermissionDecision, PermissionHookRequest, PermissionRequest, PermissionWaitResponse } from '@ai-office/shared';
export declare const PERMISSION_TTL_MS: number;
export declare const MAX_WAIT_MS = 25000;
export interface PermissionDeps {
    now: () => number;
    /** Maps the hook's session (and optional raw agent id) to an office agent id. */
    resolveAgent: (sessionId: string, rawAgentId?: string) => string | undefined;
    onChange: () => void;
}
export type CreateResult = {
    id: string;
} | {
    skip: string;
};
export type DecideResult = 'ok' | 'conflict' | 'not-found';
export declare class PermissionRegistry {
    private readonly deps;
    private readonly entries;
    constructor(deps: PermissionDeps);
    create(request: PermissionHookRequest): CreateResult;
    /** Full request (with input), pending or not. */
    get(id: string): PermissionRequest | undefined;
    /** The pending request of an agent, without the (potentially large) input. */
    pendingFor(agentId: string): PermissionRequest | undefined;
    decide(id: string, decision: PermissionDecision): DecideResult;
    /** Cancels the pending request of an agent (the session moved on: it was answered in the terminal). */
    cancelFor(agentId: string): void;
    /** Long-poll: resolves when decided/expired/cancelled, or `pending` after the timeout. */
    wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<PermissionWaitResponse>;
    /** Expires old requests and forgets finished ones. */
    sweep(): void;
    private finish;
}
