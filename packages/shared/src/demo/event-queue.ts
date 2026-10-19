// Tiny time-ordered event queue for the demo simulator. Ties keep insertion order, so runs are deterministic.

export interface QueuedEvent {
  at: number;
  seq: number;
  run: (at: number) => void;
}

export class EventQueue {
  private readonly items: QueuedEvent[] = [];
  private seq = 0;

  get size(): number {
    return this.items.length;
  }

  push(at: number, run: (at: number) => void): void {
    const event: QueuedEvent = { at, seq: this.seq++, run };
    let index = this.items.length;
    while (index > 0 && (this.items[index - 1] as QueuedEvent).at > at) index--;
    this.items.splice(index, 0, event);
  }

  /** Removes and returns the earliest event due at or before `now`. */
  popDue(now: number): QueuedEvent | undefined {
    const first = this.items[0];
    if (first === undefined || first.at > now) return undefined;
    this.items.shift();
    return first;
  }
}
