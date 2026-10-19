// Event source of the Store: the real SSE stream or the client-side simulation.
import { API, type FeedItem, type Notice, type OfficeSnapshot } from '@ai-office/shared';
import { parseFeed, parseNotice, parseSnapshot } from './parse';

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

function parseData(event: Event): unknown {
  try {
    return JSON.parse((event as MessageEvent<string>).data);
  } catch {
    return null;
  }
}

export class SseTransport implements Transport {
  private source: EventSource | null = null;

  constructor(
    private readonly url: string = API.stream,
    private readonly create: EventSourceFactory = (target) => new EventSource(target),
  ) {}

  connect(handlers: TransportHandlers): void {
    this.close();
    const source = this.create(this.url);
    this.source = source;
    source.addEventListener('open', () => handlers.onOpen());
    source.addEventListener('snapshot', (event) => {
      const snapshot = parseSnapshot(parseData(event));
      if (snapshot) handlers.onSnapshot(snapshot);
    });
    source.addEventListener('feed', (event) => {
      const items = parseFeed(parseData(event));
      if (items.length > 0) handlers.onFeed(items);
    });
    source.addEventListener('notice', (event) => {
      const notice = parseNotice(parseData(event));
      if (notice) handlers.onNotice(notice);
    });
    source.addEventListener('error', () => {
      // EventSource would retry on its own; the Store owns the backoff, so close it.
      if (this.source !== source) return;
      this.close();
      handlers.onClose();
    });
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }
}
