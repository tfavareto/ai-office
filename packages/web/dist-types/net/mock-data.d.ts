import type { Activity, Agent, DayStats, OfficeSnapshot, RecentSession, TranscriptPage } from '@ai-office/shared';
/** Accumulates the activities seen in snapshots so the mock transcript grows like a real one. */
export declare class MockLog {
    private readonly byAgent;
    observe(snapshot: OfficeSnapshot): void;
    activities(agentId: string): Activity[];
    transcript(agent: Agent | undefined, after: number): TranscriptPage;
}
export declare function mockSessions(snapshot: OfficeSnapshot, now: number): RecentSession[];
export declare function mockDay(snapshot: OfficeSnapshot, date: string): DayStats;
