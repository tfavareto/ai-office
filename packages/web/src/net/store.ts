// Store: owns the connection (with reconnection backoff) and the latest office state, and fans events out to the UI.
import type { FeedItem, Notice, OfficeSnapshot } from '@ai-office/shared';
import type { Backend } from './backend';
import { reconnectDelay } from './reconnect';
import { INITIAL_STORE_DATA, applySnapshot, markConnected, markLost, mergeFeed, type StoreData } from './reducers';
import type { Transport, TransportHandlers } from './transport';

export type StoreEvent =
  | { type: 'snapshot'; snapshot: OfficeSnapshot }
  | { type: 'feed'; items: FeedItem[] }
  | { type: 'notice'; notice: Notice }
  | { type: 'connection' };

export type StoreListener = (event: StoreEvent) => void;

export type StoreMode = 'live' | 'mock';

export interface StoreOptions {
  transport: Transport;
  backend: Backend;
  mode: StoreMode;
  clock?: () => number;
}

export class Store {
  readonly backend: Backend;
  readonly mode: StoreMode;
  private readonly transport: Transport;
  private readonly clock: () => number;
  private readonly listeners = new Set<StoreListener>();
  private state: StoreData = INITIAL_STORE_DATA;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(options: StoreOptions) {
    this.transport = options.transport;
    this.backend = options.backend;
    this.mode = options.mode;
    this.clock = options.clock ?? (() => Date.now());
  }

  get data(): StoreData {
    return this.state;
  }

  get snapshot(): OfficeSnapshot | null {
    return this.state.snapshot;
  }

  /** Local access: terminal, permissions and messages work. */
  get isLocal(): boolean {
    return this.state.snapshot?.meta.local === true;
  }

  /** Server-aligned "now" (epoch ms). */
  now(): number {
    return this.clock() + this.state.offsetMs;
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.open();
  }

  stop(): void {
    this.started = false;
    this.clearRetry();
    this.transport.close();
  }

  /** Reconnects immediately (the "Tentar agora" button, or the network coming back). */
  retryNow(): void {
    if (!this.started || this.state.connection === 'live') return;
    this.clearRetry();
    this.open();
  }

  private emit(event: StoreEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private readonly handlers: TransportHandlers = {
    onOpen: () => {
      this.state = markConnected(this.state);
      this.emit({ type: 'connection' });
    },
    onClose: () => {
      if (!this.started) return;
      const delay = reconnectDelay(this.state.attempt);
      this.state = markLost(this.state, this.clock() + delay);
      this.emit({ type: 'connection' });
      this.clearRetry();
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.open();
      }, delay);
    },
    onSnapshot: (snapshot) => {
      const next = applySnapshot(this.state, snapshot, this.clock());
      if (next === this.state) return;
      const wasLive = this.state.connection === 'live';
      this.state = wasLive ? next : markConnected(next);
      this.emit({ type: 'snapshot', snapshot });
      if (!wasLive) this.emit({ type: 'connection' });
    },
    onFeed: (items) => {
      const feed = mergeFeed(this.state.feed, items);
      if (feed === this.state.feed) return;
      this.state = { ...this.state, feed };
      this.emit({ type: 'feed', items });
    },
    onNotice: (notice) => this.emit({ type: 'notice', notice }),
  };

  private open(): void {
    this.transport.connect(this.handlers);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
