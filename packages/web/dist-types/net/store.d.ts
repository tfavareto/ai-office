import type { FeedItem, Notice, OfficeSnapshot } from '@ai-office/shared';
import type { Backend } from './backend';
import { type StoreData } from './reducers';
import type { Transport } from './transport';
export type StoreEvent = {
    type: 'snapshot';
    snapshot: OfficeSnapshot;
} | {
    type: 'feed';
    items: FeedItem[];
} | {
    type: 'notice';
    notice: Notice;
} | {
    type: 'connection';
};
export type StoreListener = (event: StoreEvent) => void;
export type StoreMode = 'live' | 'mock';
export interface StoreOptions {
    transport: Transport;
    backend: Backend;
    mode: StoreMode;
    clock?: () => number;
}
export declare class Store {
    readonly backend: Backend;
    readonly mode: StoreMode;
    private readonly transport;
    private readonly clock;
    private readonly listeners;
    private state;
    private retryTimer;
    private started;
    constructor(options: StoreOptions);
    get data(): StoreData;
    get snapshot(): OfficeSnapshot | null;
    /** Local access: terminal, permissions and messages work. */
    get isLocal(): boolean;
    /** Server-aligned "now" (epoch ms). */
    now(): number;
    subscribe(listener: StoreListener): () => void;
    start(): void;
    stop(): void;
    /** Reconnects immediately (the "Tentar agora" button, or the network coming back). */
    retryNow(): void;
    private emit;
    private readonly handlers;
    private open;
    private clearRetry;
}
