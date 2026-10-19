import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FeedItem, Notice, OfficeSnapshot } from '@ai-office/shared';
export declare const HEARTBEAT_MS = 15000;
export declare const RETRY_MS = 2000;
/** Simultaneous streams (open pages). Beyond this the route answers 503. */
export declare const MAX_CLIENTS = 20;
export interface SseDeps {
    /** Latest snapshot (meta.local is overridden per client). */
    snapshot: () => OfficeSnapshot;
    backlog: () => FeedItem[];
    heartbeatMs?: number;
}
export declare class SseHub {
    private readonly deps;
    private readonly clients;
    private readonly heartbeat;
    constructor(deps: SseDeps);
    /** Number of connected pages opened from this computer. */
    localViewers(): number;
    get size(): number;
    isFull(): boolean;
    connect(req: IncomingMessage, res: ServerResponse, local: boolean): void;
    broadcastSnapshot(snapshot: OfficeSnapshot): void;
    broadcastFeed(items: FeedItem[]): void;
    broadcastNotice(notice: Notice): void;
    closeAll(): void;
    private withLocal;
    private write;
    private send;
}
