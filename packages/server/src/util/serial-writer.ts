// Saves one at a time: each write reads the state when its turn comes, so an older write never lands after a newer one.
export class SerialWriter {
  private last: Promise<void> = Promise.resolve();

  constructor(
    private readonly write: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {}

  request(): void {
    this.last = this.last.then(this.write).catch(this.onError);
  }

  /** Waits for what was requested so far, for a clean stop. */
  flush(): Promise<void> {
    return this.last;
  }
}
