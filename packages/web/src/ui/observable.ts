// Minimal observable value holder used by the UI state, notification and toast stores.
export type Unsubscribe = () => void;

export class Observable<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(protected value: T) {}

  get(): T {
    return this.value;
  }

  protected replace(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of this.listeners) listener(next);
  }

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
