// Sliding-window rate limiter: at most `limit` events in any `windowMs`.
export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Records an event and returns true when it is allowed; a refused attempt is not recorded. */
  tryAcquire(): boolean {
    const time = this.now();
    while (this.stamps.length > 0 && time - (this.stamps[0] as number) >= this.windowMs) this.stamps.shift();
    if (this.stamps.length >= this.limit) return false;
    this.stamps.push(time);
    return true;
  }
}
