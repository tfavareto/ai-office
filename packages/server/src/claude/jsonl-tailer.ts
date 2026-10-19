// Incremental JSONL reader: keeps a byte offset, buffers partial lines, detects truncation and replacement.
import { type FileHandle, open } from 'node:fs/promises';

export const DEFAULT_TAIL_BYTES = 2 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const MAX_BYTES_PER_READ = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;

export interface TailRead {
  lines: string[];
  /** The file shrank or was replaced: previously delivered lines are no longer valid. */
  reset: boolean;
  /** True on the very first read of this tailer. */
  initial: boolean;
}

export interface TailerOptions {
  /** On the first read, start this many bytes before the end (the first partial line is dropped). */
  initialTailBytes?: number;
}

export class JsonlTailer {
  private offset = 0;
  private remainder: Buffer = Buffer.alloc(0);
  private skippingOversized = false;
  private started = false;
  private inode: number | undefined;

  constructor(
    readonly path: string,
    private readonly options: TailerOptions = {},
  ) {}

  /** Reads new complete lines. Returns undefined when the file does not exist (yet). */
  async read(): Promise<TailRead | undefined> {
    let handle: FileHandle;
    try {
      handle = await open(this.path, 'r');
    } catch {
      return undefined;
    }
    try {
      const stats = await handle.stat();
      let reset = false;
      const initial = !this.started;
      if (this.started && (stats.size < this.offset || (this.inode !== undefined && stats.ino !== this.inode))) {
        this.offset = 0;
        this.remainder = Buffer.alloc(0);
        this.skippingOversized = false;
        reset = true;
      }
      this.inode = stats.ino;
      if (!this.started) {
        this.started = true;
        const window = this.options.initialTailBytes ?? DEFAULT_TAIL_BYTES;
        if (stats.size > window) {
          this.offset = stats.size - window;
          this.skippingOversized = true;
        }
      }
      const lines = await this.drain(handle, stats.size);
      return { lines, reset, initial };
    } finally {
      await handle.close();
    }
  }

  private async drain(handle: FileHandle, size: number): Promise<string[]> {
    const lines: string[] = [];
    const end = Math.min(size, this.offset + MAX_BYTES_PER_READ);
    while (this.offset < end) {
      const length = Math.min(CHUNK_BYTES, end - this.offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
      if (bytesRead === 0) break;
      this.offset += bytesRead;
      this.consume(buffer.subarray(0, bytesRead), lines);
    }
    return lines;
  }

  private consume(chunk: Buffer, lines: string[]): void {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(NEWLINE, start);
      if (newline < 0) break;
      if (this.skippingOversized) {
        this.skippingOversized = false;
        this.remainder = Buffer.alloc(0);
      } else {
        const piece = this.remainder.length > 0 ? Buffer.concat([this.remainder, chunk.subarray(start, newline)]) : chunk.subarray(start, newline);
        this.remainder = Buffer.alloc(0);
        if (piece.length > 0) lines.push(piece.toString('utf8'));
      }
      start = newline + 1;
    }
    if (start >= chunk.length) return;
    if (this.skippingOversized) return;
    this.remainder = Buffer.concat([this.remainder, chunk.subarray(start)]);
    if (this.remainder.length > MAX_LINE_BYTES) {
      this.remainder = Buffer.alloc(0);
      this.skippingOversized = true;
    }
  }
}
