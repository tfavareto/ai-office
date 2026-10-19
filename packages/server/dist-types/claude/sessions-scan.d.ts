import { type Account, type RecentSession } from '@ai-office/shared';
export declare const RECENT_WINDOW_MS: number;
/** Scans every account for sessions modified within the window, newest first. `open` marks sessions in the office. */
export declare function scanRecentSessions(accounts: readonly Account[], now: number, open: (accountId: string, sessionId: string) => {
    agentId: string;
    title?: string;
} | undefined): Promise<RecentSession[]>;
