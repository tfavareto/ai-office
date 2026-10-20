// Book of agents being hired. The server (real hires) and the demo simulator (simulated hires) both keep one, so the
// placeholder lifecycle is the same everywhere: registered -> taken over by the real agent -> forgotten shortly after
// (every page needs a moment to hand over), or forgotten when nothing showed up within the window.
import type { PendingHire } from './model';
import { HIRE_HANDOVER_MS } from './protocol';

interface Entry {
  hire: PendingHire;
  resolvedAt?: number;
}

export class HireBook {
  private readonly entries = new Map<string, Entry>();

  add(hire: PendingHire): void {
    this.entries.set(hire.id, { hire });
  }

  get(id: string): PendingHire | undefined {
    return this.entries.get(id)?.hire;
  }

  /** Hires still waiting for their session. */
  unresolved(now: number): PendingHire[] {
    return [...this.entries.values()].filter((entry) => entry.resolvedAt === undefined && entry.hire.expiresAt > now).map((entry) => entry.hire);
  }

  /** Marks a hire as taken over by `agentId`. Returns false when it is unknown or already resolved. */
  resolve(id: string, agentId: string, now: number): boolean {
    const entry = this.entries.get(id);
    if (entry === undefined || entry.resolvedAt !== undefined) return false;
    this.entries.set(id, { hire: { ...entry.hire, agentId }, resolvedAt: now });
    return true;
  }

  /** What snapshots carry: waiting hires, and taken-over ones until the handover period ends. */
  list(now: number): PendingHire[] {
    return [...this.entries.values()]
      .filter((entry) => (entry.resolvedAt === undefined ? entry.hire.expiresAt > now : now - entry.resolvedAt < HIRE_HANDOVER_MS))
      .map((entry) => entry.hire);
  }

  /** Forgets finished entries and returns the hires that ran out of time without a session. */
  sweep(now: number): PendingHire[] {
    const expired: PendingHire[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.resolvedAt !== undefined) {
        if (now - entry.resolvedAt >= HIRE_HANDOVER_MS) this.entries.delete(id);
      } else if (entry.hire.expiresAt <= now) {
        expired.push(entry.hire);
        this.entries.delete(id);
      }
    }
    return expired;
  }
}
