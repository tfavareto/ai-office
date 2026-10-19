// Sidebar model: rooms with their agents, filtered by search and account.
import type { Account, Agent, OfficeSnapshot, Project, TaskItem } from '@ai-office/shared';
import { displayStatus, isLive, statusRank } from './status';

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

export function normalizeQuery(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function agentHaystack(agent: Agent, project: Project | undefined, account: Account | undefined): string {
  return normalizeQuery(
    [agent.name, agent.role, agent.title, agent.activity?.text, project?.name, project?.path, account?.label].filter(Boolean).join(' '),
  );
}

export function agentMatches(agent: Agent, query: string, project: Project | undefined, account: Account | undefined): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  const haystack = agentHaystack(agent, project, account);
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

function compareAgents(a: Agent, b: Agent): number {
  return statusRank(displayStatus(a)) - statusRank(displayStatus(b)) || a.startedAt - b.startedAt || a.name.localeCompare(b.name);
}

export function flattenTasks(agents: readonly Agent[]): TaskItem[] {
  return agents.flatMap((agent) => agent.tasks);
}

/**
 * Builds the rooms for the sidebar. A room appears when one of its agents matches (or its project name matches);
 * rooms keep the order of arrival so they stay where the user expects them.
 * `keepId` keeps the selected agent visible even after it left the office.
 */
export function buildRooms(snapshot: OfficeSnapshot | null, filter: SidebarFilter, keepId: string | null = null): RoomModel[] {
  if (!snapshot) return [];
  const accounts = new Map(snapshot.accounts.map((account) => [account.id, account]));
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const accountSet = new Set(filter.accountIds);
  const byRoom = new Map<string, Agent[]>();

  for (const agent of snapshot.agents) {
    if (!isLive(agent) && agent.id !== keepId) continue;
    if (accountSet.size > 0 && !accountSet.has(agent.accountId)) continue;
    const project = projects.get(agent.projectId);
    if (!agentMatches(agent, filter.query, project, accounts.get(agent.accountId))) continue;
    const list = byRoom.get(agent.projectId);
    if (list) list.push(agent);
    else byRoom.set(agent.projectId, [agent]);
  }

  const rooms: RoomModel[] = [];
  for (const project of [...snapshot.projects].sort((a, b) => a.order - b.order)) {
    const agents = byRoom.get(project.id);
    if (!agents || agents.length === 0) continue;
    rooms.push(buildRoom(project, agents));
  }
  return rooms;
}

function buildRoom(project: Project, agents: Agent[]): RoomModel {
  const mains = agents.filter((agent) => agent.kind === 'main').sort(compareAgents);
  const ids = new Set(mains.map((agent) => agent.id));
  const subs = agents.filter((agent) => agent.kind === 'sub');
  const rows: AgentRowModel[] = [];
  for (const main of mains) {
    rows.push({ agent: main, depth: 0 });
    for (const sub of subs.filter((candidate) => candidate.parentId === main.id).sort(compareAgents)) rows.push({ agent: sub, depth: 1 });
  }
  // Subagents whose parent is filtered out or unknown still show up, at the end.
  for (const sub of subs.filter((candidate) => !candidate.parentId || !ids.has(candidate.parentId)).sort(compareAgents)) {
    rows.push({ agent: sub, depth: 1 });
  }
  const tasks = flattenTasks(mains);
  return {
    project,
    rows,
    agentCount: agents.length,
    needsYou: agents.filter((agent) => agent.status === 'waiting').length,
    working: agents.filter((agent) => agent.status === 'working').length,
    tasksDone: tasks.filter((task) => task.status === 'completed').length,
    tasksTotal: tasks.length,
    accountIds: [...new Set(agents.map((agent) => agent.accountId))],
  };
}

export function findAgent(snapshot: OfficeSnapshot | null, id: string): Agent | undefined {
  return snapshot?.agents.find((agent) => agent.id === id);
}

export function agentsOfProject(snapshot: OfficeSnapshot | null, projectId: string): Agent[] {
  return snapshot ? snapshot.agents.filter((agent) => agent.projectId === projectId && isLive(agent)) : [];
}

/** Deterministic room color from the project seed. */
export function roomColor(seed: number, lightness = 56): string {
  return `hsl(${Math.abs(seed) % 360} 58% ${lightness}%)`;
}
