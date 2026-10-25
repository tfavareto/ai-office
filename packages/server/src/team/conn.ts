// A TCP connection that speaks length-prefixed frames: `u32 length || body`. Reading is a promise per frame, so the
// handshakes read as straight code. The frame size limit is set per phase; a longer frame closes the connection at once,
// so an HTTP request (or any stranger) sent to the team port is dropped without a reply.
import type { Socket } from 'node:net';

export type FrameErrorCode = 'closed' | 'timeout' | 'too-large' | 'flood' | 'slow-consumer';

export class FrameError extends Error {
  constructor(readonly code: FrameErrorCode) {
    super(code);
  }
}

const MAX_QUEUED = 64;
const MAX_WRITE_BACKLOG = 4 * 1024 * 1024;

interface Waiter {
  resolve: (frame: Buffer) => void;
  reject: (error: FrameError) => void;
  timer: NodeJS.Timeout;
}

export class FramedConn {
  private chunks: Buffer[] = [];
  private buffered = 0;
  private queue: Buffer[] = [];
  private waiter: Waiter | undefined;
  private failure: FrameError | undefined;
  private readonly closeListeners: (() => void)[] = [];

  constructor(
    private readonly socket: Socket,
    private maxBytes: number,
  ) {
    socket.setNoDelay(true);
    socket.on('data', (data: Buffer) => this.onData(data));
    socket.on('error', () => this.fail('closed'));
    socket.on('close', () => this.fail('closed'));
  }

  get remoteAddress(): string {
    const address = this.socket.remoteAddress ?? '';
    return address.startsWith('::ffff:') ? address.slice(7) : address;
  }

  get closed(): boolean {
    return this.failure !== undefined;
  }

  /** Sets the largest frame accepted from now on. */
  setMaxBytes(bytes: number): void {
    this.maxBytes = bytes;
  }

  onClose(listener: () => void): void {
    if (this.failure !== undefined) listener();
    else this.closeListeners.push(listener);
  }

  /** Sends one frame; false when the connection is gone or the peer reads too slowly (then it is closed). */
  send(body: Buffer): boolean {
    if (this.failure !== undefined || this.socket.destroyed) return false;
    if (this.socket.writableLength > MAX_WRITE_BACKLOG) {
      this.fail('slow-consumer');
      return false;
    }
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    this.socket.write(Buffer.concat([head, body]));
    return true;
  }

  /** The next frame, or a FrameError (closed, timeout, too large). */
  read(timeoutMs: number): Promise<Buffer> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(new FrameError('timeout'));
      }, timeoutMs);
      this.waiter = { resolve, reject, timer };
    });
  }

  /** Flushes what was sent, then closes. */
  close(): void {
    this.fail('closed');
    if (!this.socket.destroyed) this.socket.end(() => this.socket.destroy());
    setTimeout(() => this.socket.destroy(), 500).unref();
  }

  /** Closes without waiting. */
  destroy(): void {
    this.fail('closed');
    this.socket.destroy();
  }

  private onData(data: Buffer): void {
    if (this.failure !== undefined) return;
    this.chunks.push(data);
    this.buffered += data.length;
    while (this.failure === undefined) {
      const frame = this.takeFrame();
      if (frame === undefined) return;
      if (this.waiter !== undefined) {
        const { resolve, timer } = this.waiter;
        this.waiter = undefined;
        clearTimeout(timer);
        resolve(frame);
      } else if (this.queue.length >= MAX_QUEUED) {
        this.fail('flood');
        this.socket.destroy();
      } else this.queue.push(frame);
    }
  }

  private takeFrame(): Buffer | undefined {
    if (this.buffered < 4) return undefined;
    const all = this.chunks.length === 1 ? (this.chunks[0] as Buffer) : Buffer.concat(this.chunks);
    this.chunks = [all];
    const length = all.readUInt32BE(0);
    if (length === 0 || length > this.maxBytes) {
      this.fail('too-large');
      this.socket.destroy();
      return undefined;
    }
    if (all.length < 4 + length) return undefined;
    const frame = Buffer.from(all.subarray(4, 4 + length));
    const rest = all.subarray(4 + length);
    this.chunks = rest.length > 0 ? [Buffer.from(rest)] : [];
    this.buffered = rest.length;
    return frame;
  }

  private fail(code: FrameErrorCode): void {
    if (this.failure !== undefined) return;
    this.failure = new FrameError(code);
    if (this.waiter !== undefined) {
      const { reject, timer } = this.waiter;
      this.waiter = undefined;
      clearTimeout(timer);
      reject(this.failure);
    }
    for (const listener of this.closeListeners.splice(0)) listener();
  }
}
