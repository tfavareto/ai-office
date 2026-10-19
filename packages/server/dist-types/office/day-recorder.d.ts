import type { Agent, DayStats } from '@ai-office/shared';
import type { Logger } from '../log';
export declare const RECORD_INTERVAL_MS = 5000;
export declare const FLUSH_INTERVAL_MS = 30000;
export declare class DayRecorder {
    private readonly dir;
    private readonly log;
    private current;
    private lastRecordAt;
    private lastFlushAt;
    private dirty;
    constructor(dir: string, log: Logger);
    private fileFor;
    /** Adds the elapsed time (capped to one interval) to each present agent's status bucket. */
    record(agents: readonly Agent[], now: number): Promise<void>;
    get(date: string): Promise<DayStats>;
    private read;
    flush(now?: number): Promise<void>;
}
