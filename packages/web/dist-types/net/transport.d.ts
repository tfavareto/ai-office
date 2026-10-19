import { type FeedItem, type Notice, type OfficeSnapshot } from '@ai-office/shared';
export interface TransportHandlers {
    onOpen(): void;
    /** The connection failed or was lost; the Store schedules the next attempt. */
    onClose(): void;
    onSnapshot(snapshot: OfficeSnapshot): void;
    onFeed(items: FeedItem[]): void;
    onNotice(notice: Notice): void;
}
export interface Transport {
    connect(handlers: TransportHandlers): void;
    close(): void;
}
type EventSourceFactory = (url: string) => EventSource;
export declare class SseTransport implements Transport {
    private readonly url;
    private readonly create;
    private source;
    constructor(url?: string, create?: EventSourceFactory);
    connect(handlers: TransportHandlers): void;
    close(): void;
}
export {};
