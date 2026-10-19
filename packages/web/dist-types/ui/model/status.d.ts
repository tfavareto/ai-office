import type { Agent, ShellJob } from '@ai-office/shared';
export type DisplayStatus = 'working' | 'waiting' | 'shell' | 'idle' | 'done' | 'error' | 'offline';
export declare const STATUS_LABEL: Record<DisplayStatus, string>;
export declare const STATUS_HINT: Record<DisplayStatus, string>;
export declare function hasForegroundShell(agent: Agent): boolean;
export declare function displayStatus(agent: Agent): DisplayStatus;
/** The agent is present in the office (not leaving). */
export declare function isLive(agent: Agent): boolean;
/** Sort weight: who needs attention comes first. */
export declare function statusRank(status: DisplayStatus): number;
export interface ShellStage {
    index: number;
    label: string;
}
export declare const SHELL_STAGES: readonly {
    afterMs: number;
    label: string;
}[];
/** Where a shell job is on its lifecycle, based on how long it has been running. */
export declare function shellStage(job: Pick<ShellJob, 'startedAt'>, now: number): ShellStage;
/** Longest running shell of an agent (the one worth showing as the headline). */
export declare function primaryShell(agent: Agent): ShellJob | undefined;
