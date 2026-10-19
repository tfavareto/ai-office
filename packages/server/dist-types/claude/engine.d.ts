import type { Account } from '@ai-office/shared';
import type { Logger } from '../log';
import { type Office } from '../office/office';
import type { UsageTracker } from '../office/usage';
import { type DiscoverOptions } from './accounts';
import { type PidCheck } from './registry';
export declare const POLL_INTERVAL_MS = 1000;
/** Lines older than this at the first read of a file are history: they do not create feed items or notices. */
export declare const REPLAY_GRACE_MS = 15000;
export interface EngineDeps {
    discover: DiscoverOptions;
    office: Office;
    usage: UsageTracker;
    log: Logger;
    now: () => number;
    pidAlive?: PidCheck;
}
export declare class Engine {
    private readonly deps;
    private readonly tracked;
    private readonly watchers;
    private accounts;
    private accountsAt;
    private noRegistryScanAt;
    private timer;
    private scanTimer;
    private scanning;
    private rescan;
    private firstScan;
    private stopped;
    constructor(deps: EngineDeps);
    start(): Promise<void>;
    stop(): void;
    /** Debounced scan request (file system events). */
    requestScan(): void;
    /** One full pass. Overlapping calls are coalesced. */
    scan(): Promise<void>;
    accountList(): Account[];
    /** Counts of open sessions per account (for /api/health). */
    sessionCounts(): Map<string, number>;
    private scanOnce;
    private refreshAccounts;
    private syncAccount;
    private syncRegistryAccount;
    private syncByRecency;
    private ensureTracked;
    private close;
    private readSession;
    private resolvePath;
    private readSubagents;
    private isRecent;
    private feed;
    /** Sessions without a registry leave after 30 min without events. */
    private expireIfStale;
    private backfillUsage;
}
