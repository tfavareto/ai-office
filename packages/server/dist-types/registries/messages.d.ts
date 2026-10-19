import type { BossMessage } from '@ai-office/shared';
export declare const MESSAGE_TTL_MS: number;
export declare const MESSAGES_KEPT = 50;
export declare const MAX_TEAM_SIZE = 24;
export declare const MAX_MESSAGE_LENGTH = 8000;
export declare const MAX_WAIT_MS = 25000;
export interface InboxMessage {
    id: string;
    text: string;
    createdAt: number;
}
export interface MessageDeps {
    now: () => number;
    /** Called after a message was handed to a hook (adds the "Mensagem sua" activity). */
    onDelivered: (message: BossMessage) => void;
    onChange: () => void;
}
export declare class MessageRegistry {
    private readonly deps;
    private readonly byAgent;
    private readonly waiters;
    constructor(deps: MessageDeps);
    /** Queues the text for each agent. Several agents share a group id. */
    send(agentIds: readonly string[], text: string): BossMessage[];
    list(agentId: string): BossMessage[];
    hasQueued(agentId: string): boolean;
    /** Hands the queued messages to a hook and marks them delivered (`tool` = during work, `stop` = new instruction). */
    take(agentId: string, via: 'tool' | 'stop'): InboxMessage[];
    /** Long-poll: resolves with the queued messages as soon as one exists, or an empty list after the timeout. */
    wait(agentId: string, timeoutMs: number, signal?: AbortSignal): Promise<InboxMessage[]>;
    /** Marks queued messages older than the TTL as expired. */
    expire(): void;
    private queued;
    private wake;
}
