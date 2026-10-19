// Thin fs.watch wrapper: any change schedules a scan. Errors are ignored (the 1 s poll is the safety net).
import { type FSWatcher, watch } from 'node:fs';

export class Watchers {
  private readonly active = new Map<string, FSWatcher>();

  constructor(private readonly onChange: () => void) {}

  add(path: string): void {
    if (this.active.has(path)) return;
    try {
      const watcher = watch(path, { persistent: false }, () => this.onChange());
      watcher.on('error', () => this.remove(path));
      this.active.set(path, watcher);
    } catch {
      // Path missing or watching unsupported: polling covers it.
    }
  }

  remove(path: string): void {
    const watcher = this.active.get(path);
    if (watcher === undefined) return;
    this.active.delete(path);
    try {
      watcher.close();
    } catch {
      // Already closed.
    }
  }

  closeAll(): void {
    for (const path of [...this.active.keys()]) this.remove(path);
  }
}
