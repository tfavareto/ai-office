// The newest bytes a terminal printed, so a page that arrives later (or reloads) can redraw it.

export class ByteRing {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly capacity: number) {}

  append(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size <= this.capacity * 2) return;
    this.compact();
  }

  snapshot(): Buffer {
    this.compact();
    return this.chunks[0] ?? Buffer.alloc(0);
  }

  /** Done lazily: joining on every append would copy the whole ring for each line a terminal prints. */
  private compact(): void {
    const joined = Buffer.concat(this.chunks);
    const kept = joined.length > this.capacity ? joined.subarray(joined.length - this.capacity) : joined;
    this.chunks = [kept];
    this.size = kept.length;
  }
}
