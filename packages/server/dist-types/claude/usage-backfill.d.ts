import type { UsageRecord } from './transcript-state';
export type UsageSink = (record: UsageRecord) => void;
/** Reads `path` from its end in chunks, feeding usage records newer than `since` to `sink`. */
export declare function scanUsageBackwards(path: string, since: number, sink: UsageSink): Promise<void>;
/** Transcript files (main and subagent) of a config dir modified at or after `since`. */
export declare function listRecentTranscripts(dir: string, since: number): Promise<string[]>;
