import type { Activity, BossMessage, DayStats, PermissionDecision, RecentSession, TranscriptPage } from '@ai-office/shared';
export interface TranscriptQuery {
    sessionId: string;
    accountId: string;
    /** Subagent id, when reading a subagent's transcript. */
    agentId?: string;
    after?: number;
}
export type DecisionResult = 'ok' | 'already-answered';
export interface Backend {
    sendMessage(agentIds: readonly string[], text: string): Promise<BossMessage[]>;
    messages(agentId: string): Promise<BossMessage[]>;
    decidePermission(requestId: string, decision: PermissionDecision): Promise<DecisionResult>;
    history(agentId: string): Promise<Activity[]>;
    transcript(query: TranscriptQuery): Promise<TranscriptPage>;
    sessions(): Promise<RecentSession[]>;
    day(date: string): Promise<DayStats>;
    setDemo(on: boolean): Promise<boolean>;
}
export declare class BackendError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
/** Friendly pt-BR explanation of a failed request, for UI-facing messages. */
export declare function describeError(error: unknown): string;
