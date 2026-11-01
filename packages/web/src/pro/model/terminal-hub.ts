// The page's side of the real terminals: one stream for all of them, in order, with what each one printed kept for the
// view that attaches later; and what the person types, sent one request at a time so keys never overtake each other.
import { API, type TerminalInfo } from '@ai-office/shared';

/** A request of typing or pasting: at most 3 UTF-8 bytes per UTF-16 unit, so this stays under the server's 64 KB. */
export const MAX_INPUT_CHARS = 20_000;
/** What is kept per terminal for a view that attaches later (the same as the server replays). */
const MAX_KEPT_BYTES = 512 * 1024;
/** `EventSource.CLOSED`: the server refused the stream and the browser will not retry it. */
const STREAM_CLOSED = 2;

export interface TerminalSink {
  write(bytes: Uint8Array): void;
  /** Everything will be drawn again: the server sent a fresh replay. */
  reset(): void;
  ended(code: number): void;
}

export interface HubBackend {
  terminalInput(id: string, data: string): Promise<void>;
  terminalResize(id: string, cols: number, rows: number): Promise<void>;
  terminalKill(id: string): Promise<void>;
}

interface Kept {
  chunks: Uint8Array[];
  bytes: number;
  lastSeq: number;
  exitCode?: number;
  sink?: TerminalSink;
}

type SourceEvent = { data: string };

export function chunkInput(text: string): string[] {
  const chunks: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(at + MAX_INPUT_CHARS, text.length);
    // A high surrogate at the cut would split an emoji in half.
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    chunks.push(text.slice(at, end));
    at = end;
  }
  return chunks;
}

/** Terminals with no session in the office yet (Claude Code registers one only after its first questions). */
export function orphanTerminals(
  terminals: readonly TerminalInfo[],
  linked: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): TerminalInfo[] {
  return terminals.filter((terminal) => !linked.has(terminal.id) && !dismissed.has(terminal.id));
}

function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function parse(event: SourceEvent): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(event.data);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export class TerminalHub {
  private readonly kept = new Map<string, Kept>();
  private readonly queues = new Map<string, string>();
  private readonly infos = new Map<string, TerminalInfo>();
  private source: EventSource | null = null;
  private changed: () => void = () => undefined;

  constructor(
    private readonly backend: HubBackend,
    private readonly create: (url: string) => EventSource = (url) => new EventSource(url),
    /** A key press that did not reach the program. */
    private readonly onSendError: (error: unknown) => void = () => undefined,
  ) {}

  /** Opens the stream; a page with no terminals keeps no connection for them. */
  connect(): void {
    if (this.source !== null && this.source.readyState !== STREAM_CLOSED) return;
    this.open();
  }

  terminals(): TerminalInfo[] {
    return [...this.infos.values()];
  }

  onChange(listener: () => void): void {
    this.changed = listener;
  }

  /** Connects a view to a terminal and hands it what was printed so far. Returns how to disconnect it. */
  attach(id: string, sink: TerminalSink): () => void {
    this.connect();
    const kept = this.keep(id);
    kept.sink = sink;
    for (const chunk of kept.chunks) sink.write(chunk);
    if (kept.exitCode !== undefined) sink.ended(kept.exitCode);
    return () => {
      if (kept.sink === sink) delete kept.sink;
    };
  }

  /** Queues what the person typed; what arrives while a request is on its way goes together in the next one. */
  send(id: string, data: string): void {
    const running = this.queues.has(id);
    this.queues.set(id, (this.queues.get(id) ?? '') + data);
    if (!running) void this.drain(id);
  }

  resize(id: string, cols: number, rows: number): Promise<void> {
    return this.backend.terminalResize(id, cols, rows);
  }

  kill(id: string): Promise<void> {
    return this.backend.terminalKill(id);
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }

  private async drain(id: string): Promise<void> {
    try {
      for (let text = this.queues.get(id); text !== undefined && text !== ''; text = this.queues.get(id)) {
        this.queues.set(id, '');
        for (const chunk of chunkInput(text)) await this.backend.terminalInput(id, chunk);
      }
    } catch (error) {
      this.onSendError(error);
    } finally {
      this.queues.delete(id);
    }
  }

  private open(): void {
    const source = this.create(API.terminalStream);
    this.source = source;
    const on = (name: string, handler: (data: Record<string, unknown>) => void): void => {
      source.addEventListener(name, ((event: SourceEvent) => {
        const data = parse(event);
        if (data !== undefined) handler(data);
      }) as unknown as EventListener);
    };
    on('terminal', (data) => this.onTerminal(data));
    on('output', (data) => this.onOutput(data));
    on('exit', (data) => this.onExit(data));
  }

  private keep(id: string): Kept {
    let kept = this.kept.get(id);
    if (kept === undefined) {
      kept = { chunks: [], bytes: 0, lastSeq: 0 };
      this.kept.set(id, kept);
    }
    return kept;
  }

  private store(kept: Kept, bytes: Uint8Array): void {
    kept.chunks.push(bytes);
    kept.bytes += bytes.length;
    while (kept.bytes > MAX_KEPT_BYTES && kept.chunks.length > 1) {
      const dropped = kept.chunks.shift() as Uint8Array;
      kept.bytes -= dropped.length;
    }
  }

  private onTerminal(data: Record<string, unknown>): void {
    const info = data.info as { id?: unknown; exitCode?: unknown } | undefined;
    if (typeof info?.id !== 'string' || typeof data.seq !== 'number' || typeof data.data !== 'string') return;
    this.infos.set(info.id, info as unknown as TerminalInfo);
    this.changed();
    const kept = this.keep(info.id);
    // A terminal being announced (seq 0) says nothing about what it may have printed already.
    if (data.seq > 0) {
      const bytes = decode(data.data);
      kept.chunks = [bytes];
      kept.bytes = bytes.length;
      kept.lastSeq = data.seq;
      kept.sink?.reset();
      kept.sink?.write(bytes);
    }
    if (typeof info.exitCode === 'number') this.markEnded(kept, info.exitCode);
  }

  private onOutput(data: Record<string, unknown>): void {
    if (typeof data.id !== 'string' || typeof data.seq !== 'number' || typeof data.data !== 'string') return;
    const kept = this.keep(data.id);
    if (data.seq <= kept.lastSeq) return;
    kept.lastSeq = data.seq;
    const bytes = decode(data.data);
    this.store(kept, bytes);
    kept.sink?.write(bytes);
  }

  private onExit(data: Record<string, unknown>): void {
    if (typeof data.id !== 'string' || typeof data.code !== 'number') return;
    const known = this.infos.get(data.id);
    if (known !== undefined) {
      this.infos.set(data.id, { ...known, exitCode: data.code });
      this.changed();
    }
    this.markEnded(this.keep(data.id), data.code);
  }

  private markEnded(kept: Kept, code: number): void {
    if (kept.exitCode !== undefined) return;
    kept.exitCode = code;
    kept.sink?.ended(code);
  }
}
