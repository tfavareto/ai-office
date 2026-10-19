// Server-Sent Events hub: initial snapshot + feed backlog on connect, broadcasts, heartbeat, local viewer count.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FeedItem, Notice, OfficeSnapshot } from '@ai-office/shared';

export const HEARTBEAT_MS = 15_000;
export const RETRY_MS = 2000;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

interface Client {
  res: ServerResponse;
  local: boolean;
}

function frame(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

export interface SseDeps {
  /** Latest snapshot (meta.local is overridden per client). */
  snapshot: () => OfficeSnapshot;
  backlog: () => FeedItem[];
  heartbeatMs?: number;
}

export class SseHub {
  private readonly clients = new Set<Client>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly deps: SseDeps) {
    this.heartbeat = setInterval(() => this.write(': ping\n\n', undefined), deps.heartbeatMs ?? HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  /** Number of connected pages opened from this computer. */
  localViewers(): number {
    let count = 0;
    for (const client of this.clients) if (client.local) count++;
    return count;
  }

  get size(): number {
    return this.clients.size;
  }

  connect(req: IncomingMessage, res: ServerResponse, local: boolean): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client: Client = { res, local };
    res.write(`retry: ${RETRY_MS}\n\n`);
    res.write(frame('snapshot', JSON.stringify(this.withLocal(this.deps.snapshot(), local))));
    res.write(frame('feed', JSON.stringify(this.deps.backlog())));
    this.clients.add(client);
    const drop = (): void => {
      this.clients.delete(client);
    };
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
  }

  broadcastSnapshot(snapshot: OfficeSnapshot): void {
    const cache = new Map<boolean, string>();
    for (const client of this.clients) {
      let text = cache.get(client.local);
      if (text === undefined) {
        text = frame('snapshot', JSON.stringify(this.withLocal(snapshot, client.local)));
        cache.set(client.local, text);
      }
      this.send(client, text);
    }
  }

  broadcastFeed(items: FeedItem[]): void {
    if (items.length > 0) this.write(frame('feed', JSON.stringify(items)), undefined);
  }

  broadcastNotice(notice: Notice): void {
    this.write(frame('notice', JSON.stringify(notice)), undefined);
  }

  closeAll(): void {
    clearInterval(this.heartbeat);
    for (const client of [...this.clients]) {
      this.clients.delete(client);
      client.res.end();
    }
  }

  private withLocal(snapshot: OfficeSnapshot, local: boolean): OfficeSnapshot {
    return { ...snapshot, meta: { ...snapshot.meta, local } };
  }

  private write(text: string, only: Client | undefined): void {
    for (const client of only === undefined ? this.clients : [only]) this.send(client, text);
  }

  private send(client: Client, text: string): void {
    if (client.res.writableLength > MAX_BUFFERED_BYTES) {
      this.clients.delete(client);
      client.res.destroy();
      return;
    }
    client.res.write(text);
  }
}
