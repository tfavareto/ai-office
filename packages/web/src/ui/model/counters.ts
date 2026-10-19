// Top bar counters and "jump to next" targets.
import type { Agent, OfficeSnapshot } from '@ai-office/shared';
import { isLive } from './status';

export interface Counters {
  rooms: number;
  agents: number;
  working: number;
  subagents: number;
  shells: number;
  needsYou: number;
}

export const EMPTY_COUNTERS: Counters = { rooms: 0, agents: 0, working: 0, subagents: 0, shells: 0, needsYou: 0 };

export function computeCounters(snapshot: OfficeSnapshot | null): Counters {
  if (!snapshot) return EMPTY_COUNTERS;
  const live = snapshot.agents.filter(isLive);
  const rooms = new Set(live.map((agent) => agent.projectId));
  return {
    rooms: rooms.size,
    agents: live.filter((agent) => agent.kind === 'main').length,
    working: live.filter((agent) => agent.status === 'working').length,
    subagents: live.filter((agent) => agent.kind === 'sub').length,
    shells: live.reduce((sum, agent) => sum + agent.shells.length, 0),
    needsYou: live.filter((agent) => agent.status === 'waiting').length,
  };
}

/** Agents that need the user, permission requests first, then oldest waiting first. */
export function agentsNeedingYou(agents: readonly Agent[]): Agent[] {
  return agents
    .filter((agent) => isLive(agent) && agent.status === 'waiting')
    .sort((a, b) => {
      const pa = a.permission ? 0 : 1;
      const pb = b.permission ? 0 : 1;
      return pa - pb || a.statusSince - b.statusSince || a.id.localeCompare(b.id);
    });
}

export function agentsWithPermission(agents: readonly Agent[]): Agent[] {
  return agentsNeedingYou(agents).filter((agent) => agent.permission);
}

/** Agents running shells, the longest running first. */
export function agentsWithShells(agents: readonly Agent[]): Agent[] {
  const oldest = (agent: Agent): number => Math.min(...agent.shells.map((shell) => shell.startedAt));
  return agents
    .filter((agent) => isLive(agent) && agent.shells.length > 0)
    .sort((a, b) => oldest(a) - oldest(b) || a.id.localeCompare(b.id));
}

/** The item after `currentId` in a cyclic list (the first one when current is absent). */
export function nextAfter<T extends { id: string }>(items: readonly T[], currentId: string | null): T | undefined {
  if (items.length === 0) return undefined;
  const index = currentId === null ? -1 : items.findIndex((item) => item.id === currentId);
  return items[(index + 1) % items.length];
}
