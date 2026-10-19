import type { FeedItem, OfficeSnapshot } from '@ai-office/shared';
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';
export interface StoreData {
    snapshot: OfficeSnapshot | null;
    /** Chronological (oldest first). */
    feed: FeedItem[];
    connection: ConnectionStatus;
    /** serverTime - local clock, to show server-aligned elapsed times. */
    offsetMs: number;
    /** Consecutive failed connection attempts. */
    attempt: number;
    /** When the next reconnection attempt fires (epoch ms), or null. */
    retryAt: number | null;
    everConnected: boolean;
}
export declare const FEED_LIMIT = 200;
export declare const INITIAL_STORE_DATA: StoreData;
/** Older snapshots (out-of-order) are dropped, except after a server restart (new `startedAt`). */
export declare function shouldAcceptSnapshot(current: OfficeSnapshot | null, incoming: OfficeSnapshot): boolean;
export declare function applySnapshot(data: StoreData, incoming: OfficeSnapshot, localNow: number): StoreData;
/** Appends new items, deduplicating by id, keeping chronological order and the newest `limit` entries. */
export declare function mergeFeed(feed: readonly FeedItem[], incoming: readonly FeedItem[], limit?: number): FeedItem[];
export declare function markConnected(data: StoreData): StoreData;
export declare function markLost(data: StoreData, retryAt: number): StoreData;
/** The server is serving a different web build than the one running in this page. */
export declare function buildChanged(previous: string | undefined, next: string | undefined): boolean;
