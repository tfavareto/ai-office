import type { Account, Agent, OfficeSnapshot, Project, TaskItem } from '@ai-office/shared';
export interface AgentRowModel {
    agent: Agent;
    /** 0 for main agents, 1 for subagents shown under their parent. */
    depth: 0 | 1;
}
export interface RoomModel {
    project: Project;
    rows: AgentRowModel[];
    /** Number of agents (main + sub) in the room, after filtering. */
    agentCount: number;
    needsYou: number;
    working: number;
    tasksDone: number;
    tasksTotal: number;
    accountIds: string[];
}
export interface SidebarFilter {
    query: string;
    /** Selected account ids; empty means every account. */
    accountIds: readonly string[];
}
export declare function normalizeQuery(query: string): string;
export declare function agentMatches(agent: Agent, query: string, project: Project | undefined, account: Account | undefined): boolean;
export declare function flattenTasks(agents: readonly Agent[]): TaskItem[];
/**
 * Builds the rooms for the sidebar. A room appears when one of its agents matches (or its project name matches);
 * rooms keep the order of arrival so they stay where the user expects them.
 * `keepId` keeps the selected agent visible even after it left the office.
 */
export declare function buildRooms(snapshot: OfficeSnapshot | null, filter: SidebarFilter, keepId?: string | null): RoomModel[];
export declare function findAgent(snapshot: OfficeSnapshot | null, id: string): Agent | undefined;
export declare function agentsOfProject(snapshot: OfficeSnapshot | null, projectId: string): Agent[];
/** Deterministic room color from the project seed. */
export declare function roomColor(seed: number, lightness?: number): string;
