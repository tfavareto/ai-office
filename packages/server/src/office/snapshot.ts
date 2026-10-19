// Builds OfficeSnapshots and publishes them at most 4 times per second.
import type { OfficeMeta, OfficeSnapshot } from '@ai-office/shared';
import type { UsageTracker } from './usage';
import type { Office } from './office';

export const SNAPSHOT_MIN_INTERVAL_MS = 250;

export interface SnapshotDeps {
  office: Office;
  usage: UsageTracker;
  now: () => number;
  meta: () => Omit<OfficeMeta, 'local'>;
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
    return {
      rev: this.rev,
      serverTime: now,
      meta: { ...this.deps.meta(), local: true },
      accounts: state.accounts,
      projects: state.projects,
      agents: state.agents,
      usage: [...realUsage, ...state.demoUsage],
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
