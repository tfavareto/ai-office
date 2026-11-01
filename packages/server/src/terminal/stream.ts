// The one stream a page opens for all its terminals: what each one prints, as Server-Sent Events. A browser allows few
// connections per site, so one stream per terminal would starve the page. What the person types goes by POST, through
// the same request checks as every other action.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TerminalEvent, TerminalService } from './service';

const HEARTBEAT_MS = 15_000;
const RETRY_MS = 2000;
/**
 * A page this far behind is cut off; it reconnects and redraws from the replay. Above what a full replay takes (16
 * terminals of 512 KB in base64, about 11 MB), or a page would be cut off for the replay itself, over and over.
 */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
export const MAX_TERMINAL_STREAMS = 8;

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class TerminalStreams {
  private readonly clients = new Set<ServerResponse>();
  private readonly unsubscribe: () => void;
  private readonly heartbeat: NodeJS.Timeout;

  constructor(private readonly terminals: TerminalService) {
    this.unsubscribe = terminals.subscribe((event) => this.onEvent(event));
    this.heartbeat = setInterval(() => {
      this.terminals.sweep();
      this.broadcast(': ping\n\n');
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  isFull(): boolean {
    return this.clients.size >= MAX_TERMINAL_STREAMS;
  }

  connect(req: IncomingMessage, res: ServerResponse): void {
    req.socket.setTimeout(0);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${RETRY_MS}\n\n`);
    // Everything a page that just arrived needs to redraw; `seq` tells the live chunks already in it.
    for (const info of this.terminals.list()) {
      const replay = this.terminals.replay(info.id);
      if (replay === undefined) continue;
      res.write(frame('terminal', { info, seq: replay.seq, data: replay.data.toString('base64') }));
    }
    this.clients.add(res);
    const drop = (): void => {
      this.clients.delete(res);
    };
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
  }

  /** A terminal that started after the stream opened. */
  announce(id: string): void {
    const info = this.terminals.list().find((terminal) => terminal.id === id);
    if (info !== undefined) this.broadcast(frame('terminal', { info, seq: 0, data: '' }));
  }

  closeAll(): void {
    clearInterval(this.heartbeat);
    this.unsubscribe();
    for (const res of [...this.clients]) {
      this.clients.delete(res);
      res.end();
    }
  }

  private onEvent(event: TerminalEvent): void {
    if (event.kind === 'exit') this.broadcast(frame('exit', { id: event.id, code: event.code }));
    else this.broadcast(frame('output', { id: event.id, seq: event.seq, data: event.data.toString('base64') }));
  }

  private broadcast(text: string): void {
    for (const res of this.clients) {
      if (res.writableLength > MAX_BUFFERED_BYTES) {
        this.clients.delete(res);
        res.destroy();
      } else res.write(text);
    }
  }
}
