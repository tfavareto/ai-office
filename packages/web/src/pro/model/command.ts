// The command bar's model: whom a typed order can go to, why it cannot, and what honestly happens to it. Messages are
// handed to the agent by the plugin's hooks, so what the user is told depends on what the agent is doing: a working
// agent gets it after its next tool call; one that just finished waits in "stand-by" for a while and takes it as a new
// instruction; past stand-by it only reads it when it starts working again.
import { isCodex, type Agent, type OfficeSnapshot, type Project } from '@ai-office/shared';
import { sidebarOrder } from '../../layout/arrange';
import { splitTeam } from '../../ui/model/source';

/** The longest the plugin's Stop hook waits for a message after a turn ends (AI_OFFICE_STANDBY_MIN, at most 10). */
export const STANDBY_MS = 10 * 60_000;

export type BlockReason = 'local' | 'nobody' | 'codex' | 'ended' | 'team-codex';

/** What will happen to a message sent to an agent, by what the agent is doing now. */
export type DeliveryOutlook = 'afterTool' | 'standby' | 'beyondStandby' | 'afterPermission' | 'blocked';

export interface CommandTarget {
  /** `agent:<id>` or `room:<projectId>`. */
  key: string;
  kind: 'agent' | 'room';
  label: string;
  /** Room name (the group of the selector). */
  roomName: string;
  agentIds: readonly string[];
  /** Agents of the room that cannot receive it (Codex). */
  skipped: number;
  blocked: BlockReason | null;
  outlook: DeliveryOutlook;
}

export function isEnded(agent: Pick<Agent, 'status'>): boolean {
  return agent.status === 'done' || agent.status === 'offline';
}

/** What a message to this agent will meet, from what it is doing and for how long. */
export function outlookFor(agent: Pick<Agent, 'status' | 'statusSince' | 'source'>, now: number): DeliveryOutlook {
  if (isCodex(agent) || isEnded(agent)) return 'blocked';
  switch (agent.status) {
    case 'working':
      return 'afterTool';
    case 'waiting':
      return 'afterPermission';
    case 'idle':
      return now - agent.statusSince <= STANDBY_MS ? 'standby' : 'beyondStandby';
    default:
      return 'afterTool';
  }
}

function agentBlock(agent: Agent): BlockReason | null {
  if (isCodex(agent)) return 'codex';
  return isEnded(agent) ? 'ended' : null;
}

function roomOutlook(reachable: readonly Agent[], now: number): DeliveryOutlook {
  const outlooks = reachable.map((agent) => outlookFor(agent, now));
  if (outlooks.includes('beyondStandby')) return 'beyondStandby';
  if (outlooks.includes('afterPermission')) return 'afterPermission';
  if (outlooks.includes('standby')) return 'standby';
  return outlooks.length > 0 ? 'afterTool' : 'blocked';
}

/** Orchestrators and rooms, in the order of the building. Rooms with a single orchestrator offer only the agent. */
export function buildTargets(snapshot: OfficeSnapshot | null, now: number, local: boolean): CommandTarget[] {
  if (snapshot === null) return [];
  const projects = new Map<string, Project>(snapshot.projects.map((project) => [project.id, project]));
  const targets: CommandTarget[] = [];
  for (const projectId of sidebarOrder(snapshot.projects)) {
    const project = projects.get(projectId);
    const mains = snapshot.agents
      .filter((agent) => agent.kind === 'main' && agent.projectId === projectId && !isEnded(agent))
      .sort((a, b) => a.startedAt - b.startedAt);
    if (project === undefined || mains.length === 0) continue;
    const split = splitTeam(mains);
    if (mains.length > 1) {
      targets.push({
        key: `room:${projectId}`,
        kind: 'room',
        label: project.name,
        roomName: project.name,
        agentIds: split.reachable.map((agent) => agent.id),
        skipped: split.readOnly.length,
        blocked: !local ? 'local' : split.reachable.length === 0 ? 'team-codex' : null,
        outlook: roomOutlook(split.reachable, now),
      });
    }
    for (const agent of mains) {
      const reason = agentBlock(agent);
      targets.push({
        key: `agent:${agent.id}`,
        kind: 'agent',
        label: agent.name,
        roomName: project.name,
        agentIds: reason === null ? [agent.id] : [],
        skipped: 0,
        blocked: !local ? 'local' : reason,
        outlook: outlookFor(agent, now),
      });
    }
  }
  return targets;
}

/**
 * The target the bar starts on: the one the user has selected (a subagent counts as its orchestrator), else the first
 * that is busy, else the first one.
 */
export function defaultTargetKey(
  targets: readonly CommandTarget[],
  snapshot: OfficeSnapshot | null,
  selectedAgentId: string | null,
): string | null {
  if (selectedAgentId !== null && snapshot !== null) {
    const selected = snapshot.agents.find((agent) => agent.id === selectedAgentId);
    const main = selected?.kind === 'sub' ? snapshot.agents.find((agent) => agent.id === selected.parentId) : selected;
    const key = main === undefined ? undefined : `agent:${main.id}`;
    if (key !== undefined && targets.some((target) => target.key === key)) return key;
  }
  const agentTargets = targets.filter((target) => target.kind === 'agent');
  const busy = agentTargets.find((target) => target.blocked === null && target.outlook === 'afterTool');
  return (busy ?? agentTargets.find((target) => target.blocked === null) ?? agentTargets[0] ?? targets[0])?.key ?? null;
}

/** Keeps the user's choice while it still exists; otherwise falls back to the default. */
export function resolveTargetKey(
  targets: readonly CommandTarget[],
  chosen: string | null,
  fallback: string | null,
): string | null {
  return chosen !== null && targets.some((target) => target.key === chosen) ? chosen : fallback;
}

export function canSend(target: CommandTarget | undefined, text: string, sending: boolean): boolean {
  return (
    target !== undefined && target.blocked === null && target.agentIds.length > 0 && !sending && text.trim().length > 0
  );
}
