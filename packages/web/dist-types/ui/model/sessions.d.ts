import type { RecentSession } from '@ai-office/shared';
export interface SessionDayGroup {
    key: number;
    label: string;
    sessions: RecentSession[];
}
export declare function filterSessions(sessions: readonly RecentSession[], query: string): RecentSession[];
/** Groups sessions by the local day of their last activity, newest day and newest session first. */
export declare function groupSessionsByDay(sessions: readonly RecentSession[], now: number): SessionDayGroup[];
