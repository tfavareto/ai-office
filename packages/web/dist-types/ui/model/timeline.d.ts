import type { Activity, Agent, OfficeSnapshot } from '@ai-office/shared';
export declare const MAX_TIMELINE = 300;
/** Newest first, deduplicated by id. */
export declare function mergeTimeline(recent: readonly Activity[], history: readonly Activity[], max?: number): Activity[];
export interface RoomActivity {
    agent: Agent;
    activity: Activity;
}
/** Latest activities across the agents of a room, newest first. */
export declare function roomActivities(agents: readonly Agent[], limit?: number): RoomActivity[];
export declare function snapshotAgent(snapshot: OfficeSnapshot | null, id: string): Agent | undefined;
