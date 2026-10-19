import { type Activity, type ActivityDraft, type AgentStats, type ShellJob, type TaskItem } from '@ai-office/shared';
import { type ParsedLine, type UsageInfo } from './types';
export interface PendingTool {
    id: string;
    name: string;
    at: number;
    input: Record<string, unknown>;
    background: boolean;
}
export interface SpawnInfo {
    toolUseId: string;
    description: string;
    subagentType?: string;
    at: number;
    async: boolean;
    done: boolean;
    /** When the completion (result or notification) was seen. */
    doneAt?: number;
    agentId?: string;
}
export interface UsageRecord {
    messageId?: string;
    at: number;
    model?: string;
    usage: UsageInfo;
}
/** What one applied line produced (consumed by the office for feed, notices, permissions and usage). */
export interface ApplyEffects {
    activities: Activity[];
    usage?: UsageRecord;
    promptSeen: boolean;
    interrupted: boolean;
    newAssistantMessage: boolean;
    toolResults: {
        toolUseId: string;
        name: string;
    }[];
    turnCompleted?: {
        durationMs: number;
    };
    error?: {
        tool: string;
        detail?: string;
    };
}
export interface TranscriptStateOptions {
    /** Prefix for activity ids. */
    idPrefix: string;
    isSub: boolean;
}
export type TurnState = 'working' | 'idle';
export declare class TranscriptState {
    private readonly options;
    private readonly stats;
    private readonly history;
    private readonly pending;
    private readonly spawnMap;
    private readonly jobs;
    private readonly taskAliases;
    private readonly resultIds;
    private seq;
    private lastMessageId;
    private tasksList;
    turn: TurnState;
    turnStartedAt: number;
    lastEventAt: number;
    firstEventAt: number;
    customTitle: string | undefined;
    firstPrompt: string | undefined;
    lastPrompt: string | undefined;
    model: string | undefined;
    gitBranch: string | undefined;
    permissionMode: string | undefined;
    cwd: string | undefined;
    sawAny: boolean;
    constructor(options: TranscriptStateOptions);
    get tasks(): readonly TaskItem[];
    get activity(): Activity | undefined;
    recent(): Activity[];
    activityHistory(): Activity[];
    spawns(): SpawnInfo[];
    spawn(toolUseId: string): SpawnInfo | undefined;
    /** True when the tool call finished (a result or notification was seen), even if the tool_use was not read. */
    isFinished(toolUseId: string): boolean;
    pendingTools(): PendingTool[];
    /** A tool that needs the user (question, plan approval), with the text for "waitingFor". */
    pendingUserTool(): {
        tool: PendingTool;
        waitingFor: string;
    } | undefined;
    /** Oldest pending tool that would normally finish quickly (excludes delegation and user tools). */
    oldestBlockingTool(): PendingTool | undefined;
    /** Background shells and monitors, plus foreground Bash calls running longer than 10 s. */
    shellsAt(now: number): ShellJob[];
    statsSnapshot(): AgentStats;
    /** Display title: custom title, else first prompt, else last prompt (80 chars max). */
    title(): string | undefined;
    /** Records an activity that does not come from the transcript (message delivered, permission requested...). */
    addExternal(draft: ActivityDraft, at: number): Activity;
    apply(line: ParsedLine): ApplyEffects;
    private touch;
    private push;
    private onPrompt;
    private onInterrupt;
    private dropForegroundTools;
    private rememberResult;
    private onResults;
    private finishTool;
    private applyStructured;
    private onNotification;
    private onAssistant;
    private endTurn;
    private onToolUse;
    private registerSpawn;
    private addJob;
    private removeJob;
}
