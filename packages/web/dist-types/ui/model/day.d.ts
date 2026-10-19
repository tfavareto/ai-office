import type { DayStats } from '@ai-office/shared';
export declare const DAY_STATUSES: readonly ["working", "waiting", "idle"];
export type DayStatus = (typeof DAY_STATUSES)[number];
export declare const DAY_STATUS_LABEL: Record<DayStatus, string>;
export interface DaySegment {
    status: DayStatus;
    ms: number;
    /** Width in percent of the longest row. */
    widthPct: number;
}
export interface DayRow {
    agentId: string;
    name: string;
    projectId: string;
    totalMs: number;
    segments: DaySegment[];
}
export interface DayView {
    rows: DayRow[];
    totals: Record<DayStatus, number>;
    totalMs: number;
}
export declare function aggregateDay(stats: DayStats): DayView;
