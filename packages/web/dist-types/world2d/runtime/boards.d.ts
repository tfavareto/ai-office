import type { Agent } from '@ai-office/shared';
export interface RoomInfo {
    agents: number;
    working: number;
    waiting: number;
    tasksTotal: number;
    tasksDone: number;
    current: string | null;
}
export declare function summarizeRoom(agents: readonly Agent[]): RoomInfo;
export declare function roomInfoKey(info: RoomInfo): string;
/** Wall board of a project room: task progress and the task being worked on. */
export declare function renderBoard(w: number, h: number, info: RoomInfo, accent: string): HTMLCanvasElement;
/** Meeting-room TV: who is in the room. */
export declare function renderMeetingTv(w: number, h: number, names: readonly string[]): HTMLCanvasElement;
