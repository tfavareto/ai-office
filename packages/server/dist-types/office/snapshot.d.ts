import type { OfficeMeta, OfficeSnapshot } from '@ai-office/shared';
import type { UsageTracker } from './usage';
import type { Office } from './office';
export declare const SNAPSHOT_MIN_INTERVAL_MS = 250;
export interface SnapshotDeps {
    office: Office;
    usage: UsageTracker;
    now: () => number;
    meta: () => Omit<OfficeMeta, 'local'>;
    emit: (snapshot: OfficeSnapshot) => void;
    minIntervalMs?: number;
}
export declare class SnapshotPublisher {
    private readonly deps;
    private rev;
    private lastEmitAt;
    private timer;
    private readonly minInterval;
    constructor(deps: SnapshotDeps);
    /** The current state as a snapshot (does not change `rev`). `local` is filled in per connection by the SSE hub. */
    build(): OfficeSnapshot;
    /** Requests a publication: immediate when the last one is old enough, otherwise delayed to respect the rate limit. */
    markDirty(): void;
    stop(): void;
    private publish;
}
