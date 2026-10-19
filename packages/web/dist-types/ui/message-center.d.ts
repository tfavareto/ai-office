import type { BossMessage } from '@ai-office/shared';
import type { Backend } from '../net/backend';
import { type DeliverySummary } from './model/delivery';
import { Observable } from './observable';
export declare const MESSAGE_POLL_MS = 3000;
export type MessagesByAgent = ReadonlyMap<string, readonly BossMessage[]>;
export interface MessageCenterOptions {
    backend: Backend;
    nameOf(agentId: string): string;
    onDelivery(summary: DeliverySummary, agentId: string, final: boolean): void;
    now(): number;
}
export declare class MessageCenter extends Observable<MessagesByAgent> {
    private readonly opts;
    private readonly watchedAgents;
    private readonly tracked;
    private timer;
    private busy;
    constructor(opts: MessageCenterOptions);
    messagesOf(agentId: string): readonly BossMessage[];
    /** Registers messages just sent (they are followed until delivered or expired). */
    track(messages: readonly BossMessage[], teamLabel?: string): void;
    /** The agents whose messages a view is showing; polling runs while at least one view watches. */
    watch(viewId: string, agentIds: readonly string[]): void;
    unwatch(viewId: string): void;
    refresh(agentIds: readonly string[]): Promise<void>;
    private ingest;
    private messagesFor;
    private summaryOf;
    private afterRefresh;
    private pollTargets;
    private ensurePolling;
    private stopIfIdle;
    dispose(): void;
}
