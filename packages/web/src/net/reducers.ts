// Pure state transitions of the Store (kept free of timers and sockets so they are easy to test).
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

export const FEED_LIMIT = 200;

export const INITIAL_STORE_DATA: StoreData = {
  snapshot: null,
  feed: [],
  connection: 'connecting',
  offsetMs: 0,
  attempt: 0,
  retryAt: null,
  everConnected: false,
};

/** Older snapshots (out-of-order) are dropped, except after a server restart (new `startedAt`). */
export function shouldAcceptSnapshot(current: OfficeSnapshot | null, incoming: OfficeSnapshot): boolean {
  if (!current) return true;
  if (incoming.meta.startedAt !== current.meta.startedAt) return true;
  return incoming.rev >= current.rev;
}

export function applySnapshot(data: StoreData, incoming: OfficeSnapshot, localNow: number): StoreData {
  if (!shouldAcceptSnapshot(data.snapshot, incoming)) return data;
  return { ...data, snapshot: incoming, offsetMs: incoming.serverTime - localNow };
}

/** Appends new items, deduplicating by id, keeping chronological order and the newest `limit` entries. */
export function mergeFeed(feed: readonly FeedItem[], incoming: readonly FeedItem[], limit = FEED_LIMIT): FeedItem[] {
  if (incoming.length === 0) return feed as FeedItem[];
  const known = new Set(feed.map((item) => item.id));
  const fresh = incoming.filter((item) => {
    if (known.has(item.id)) return false;
    known.add(item.id);
    return true;
  });
  if (fresh.length === 0) return feed as FeedItem[];
  const merged = [...feed, ...fresh].sort((a, b) => a.activity.at - b.activity.at);
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

export function markConnected(data: StoreData): StoreData {
  return { ...data, connection: 'live', attempt: 0, retryAt: null, everConnected: true };
}

export function markLost(data: StoreData, retryAt: number): StoreData {
  return { ...data, connection: 'reconnecting', attempt: data.attempt + 1, retryAt };
}

/** The server is serving a different web build than the one running in this page. */
export function buildChanged(previous: string | undefined, next: string | undefined): boolean {
  return previous !== undefined && next !== undefined && previous !== next;
}
