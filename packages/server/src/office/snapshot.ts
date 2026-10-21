// Builds OfficeSnapshots and publishes them at most 4 times per second.
import type { AccountUsage, OfficeMeta, OfficeSnapshot, PendingHire } from '@ai-office/shared';
import type { Office } from './office';

export const SNAPSHOT_MIN_INTERVAL_MS = 250;

export interface SnapshotDeps {
  office: Office;
  /** The figures of the usage cards for these accounts. */
  usage: { compute(accountIds: readonly string[], now: number): AccountUsage[] };
  now: () => number;
  meta: () => Omit<OfficeMeta, 'local'>;
  /** Real agents being hired (the demo's come with the office state). */
  hires: (now: number) => PendingHire[];
  emit: (snapshot: OfficeSnapshot) => void;
  minIntervalMs?: number;
}

export class SnapshotPublisher {
  private rev = 0;
  private lastEmitAt = Number.NEGATIVE_INFINITY;
  private timer: NodeJS.Timeout | undefined;
  private readonly minInterval: number;

  constructor(private readonly deps: SnapshotDeps) {
    this.minInterval = deps.minIntervalMs ?? SNAPSHOT_MIN_INTERVAL_MS;
  }

  /** The current state as a snapshot (does not change `rev`). `local` is filled in per connection by the SSE hub. */
  build(): OfficeSnapshot {
    const now = this.deps.now();
    const state = this.deps.office.state();
    const realUsage = this.deps.usage.compute(
      state.accounts.filter((account) => !state.demoUsage.some((usage) => usage.accountId === account.id)).map((account) => account.id),
      now,
    );
    const hires = [...this.deps.hires(now), ...state.demoHires];
    return {
      rev: this.rev,
      serverTime: now,
      meta: { ...this.deps.meta(), local: true },
      accounts: state.accounts,
      projects: state.projects,
      agents: state.agents,
      usage: [...realUsage, ...state.demoUsage],
      ...(hires.length > 0 ? { hires } : {}),
    };
  }

  /** Requests a publication: immediate when the last one is old enough, otherwise delayed to respect the rate limit. */
  markDirty(): void {
    if (this.timer !== undefined) return;
    const wait = this.lastEmitAt + this.minInterval - this.deps.now();
    if (wait <= 0) {
      this.publish();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.publish();
    }, wait);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private publish(): void {
    this.rev++;
    this.lastEmitAt = this.deps.now();
    this.deps.emit(this.build());
  }
}
