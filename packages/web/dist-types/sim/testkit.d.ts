import type { Agent, AgentStatus, OfficeSnapshot, Project } from '@ai-office/shared';
/** Synthetic fixtures for simulation tests and the dev harness. */
export declare function makeProject(i: number): Project;
export declare function makeAgent(id: string, projectIndex: number, status?: AgentStatus, over?: Partial<Agent>): Agent;
export declare function makeSnapshot(projects: number, agents: Agent[], rev?: number): OfficeSnapshot;
