import type { FeedItem } from '@ai-office/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activity, snapshot } from '../test/fixtures';
import type { Backend } from './backend';
import { RECONNECT_MAX_MS, RECONNECT_MIN_MS, reconnectDelay } from './reconnect';
import { INITIAL_STORE_DATA, applySnapshot, buildChanged, mergeFeed, shouldAcceptSnapshot } from './reducers';
import { Store, type StoreEvent } from './store';
import type { Transport, TransportHandlers } from './transport';

class FakeTransport implements Transport {
  handlers: TransportHandlers | null = null;
  connects = 0;
  connect(handlers: TransportHandlers): void {
    this.handlers = handlers;
    this.connects++;
  }
  close(): void {
    this.handlers = null;
  }
}

const backend = {} as Backend;

function feedItem(id: string, at: number): FeedItem {
  return { id, agentId: 'ag1', agentName: 'Ana', projectId: 'p1', activity: activity({ id: `act-${id}`, at }) };
}

describe('reconnectDelay', () => {
  it('doubles from 2 s up to 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(reconnectDelay(0)).toBe(RECONNECT_MIN_MS);
    expect(reconnectDelay(100)).toBe(RECONNECT_MAX_MS);
  });

  it('treats negative attempts as the first one', () => {
    expect(reconnectDelay(-3)).toBe(2000);
  });
});

describe('reducers', () => {
  it('accepts newer snapshots and drops older ones', () => {
    const current = snapshot({ rev: 5 });
    expect(shouldAcceptSnapshot(current, snapshot({ rev: 5 }))).toBe(true);
    expect(shouldAcceptSnapshot(current, snapshot({ rev: 4 }))).toBe(false);
  });

  it('accepts a lower rev after a server restart', () => {
    const current = snapshot({ rev: 50 });
    const restarted = snapshot({ rev: 1, meta: { ...current.meta, startedAt: 999 } });
    expect(shouldAcceptSnapshot(current, restarted)).toBe(true);
  });

  it('computes the server clock offset', () => {
    const data = applySnapshot(INITIAL_STORE_DATA, snapshot({ serverTime: 10_000 }), 4_000);
    expect(data.offsetMs).toBe(6_000);
  });

  it('merges feed items without duplicates, oldest first, capped', () => {
    const first = mergeFeed([], [feedItem('b', 20), feedItem('a', 10)]);
    expect(first.map((i) => i.id)).toEqual(['a', 'b']);
    const again = mergeFeed(first, [feedItem('b', 20), feedItem('c', 30)]);
    expect(again.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(mergeFeed(again, [feedItem('d', 40)], 2).map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('returns the same feed array when nothing is new', () => {
    const feed = mergeFeed([], [feedItem('a', 1)]);
    expect(mergeFeed(feed, [feedItem('a', 1)])).toBe(feed);
  });

  it('detects a changed web build only when both are known', () => {
    expect(buildChanged('a', 'b')).toBe(true);
    expect(buildChanged('a', 'a')).toBe(false);
    expect(buildChanged(undefined, 'b')).toBe(false);
    expect(buildChanged('a', undefined)).toBe(false);
  });
});

describe('Store', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const transport = new FakeTransport();
    const store = new Store({ transport, backend, mode: 'live' });
    const events: StoreEvent['type'][] = [];
    store.subscribe((e) => events.push(e.type));
    return { transport, store, events };
  }

  it('becomes live on the first snapshot and exposes locality', () => {
    const { transport, store } = setup();
    store.start();
    expect(store.data.connection).toBe('connecting');
    transport.handlers?.onSnapshot(snapshot());
    expect(store.data.connection).toBe('live');
    expect(store.isLocal).toBe(true);
  });

  it('reconnects with exponential backoff and resets after success', () => {
    const { transport, store } = setup();
    store.start();
    transport.handlers?.onOpen();
    transport.handlers?.onClose();
    expect(store.data.connection).toBe('reconnecting');
    expect(store.data.attempt).toBe(1);
    vi.advanceTimersByTime(1999);
    expect(transport.connects).toBe(1);
    vi.advanceTimersByTime(1);
    expect(transport.connects).toBe(2);

    transport.handlers?.onClose();
    vi.advanceTimersByTime(3999);
    expect(transport.connects).toBe(2);
    vi.advanceTimersByTime(1);
    expect(transport.connects).toBe(3);

    transport.handlers?.onOpen();
    expect(store.data.attempt).toBe(0);
    expect(store.data.connection).toBe('live');
  });

  it('retries immediately on request and stops cleanly', () => {
    const { transport, store } = setup();
    store.start();
    transport.handlers?.onClose();
    store.retryNow();
    expect(transport.connects).toBe(2);
    transport.handlers?.onClose();
    store.stop();
    vi.advanceTimersByTime(60_000);
    expect(transport.connects).toBe(2);
  });

  it('forwards feed and notices', () => {
    const { transport, store, events } = setup();
    store.start();
    transport.handlers?.onFeed([feedItem('a', 1)]);
    transport.handlers?.onNotice({ id: 'n1', at: 1, level: 'info', text: 'oi' });
    expect(store.data.feed).toHaveLength(1);
    expect(events).toEqual(['feed', 'notice']);
  });

  it('aligns now() to the server clock', () => {
    const transport = new FakeTransport();
    const store = new Store({ transport, backend, mode: 'live', clock: () => 4_000 });
    store.start();
    transport.handlers?.onSnapshot(snapshot({ serverTime: 10_000 }));
    expect(store.now()).toBe(10_000);
  });
});
