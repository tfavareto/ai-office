import type { PermissionDecision, PermissionHookRequest } from '@ai-office/shared';
export declare function parsePermissionHookRequest(body: unknown): PermissionHookRequest;
export declare function parseDecision(body: unknown, suggestionCount: number): PermissionDecision;
export declare function parseSendMessage(body: unknown, maxAgents: number, maxText: number): {
    agents: string[];
    text: string;
};
export declare function parseInboxRequest(body: unknown): {
    sessionId: string;
    agentId?: string;
    via: 'tool' | 'stop';
};
export declare function parseAttention(body: unknown): {
    sessionId: string;
    agentId?: string;
    message?: string;
    type?: string;
};
/** Seconds query parameter converted to milliseconds, clamped to [0, maxSeconds]. */
export declare function parseTimeoutMs(raw: string | null, maxSeconds: number, fallbackSeconds: number): number;
