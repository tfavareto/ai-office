// The room panel's model: the orchestrators of a room (one chosen), how long each has been running, its model, branch
// and spend, and the subagents it delegated to (running and finished). Built from the canvas scene. Pure.
import { isCodex, type Agent, type ProjectGit } from '@ai-office/shared';
import { agentRole, agentTitle } from '../../ui/display';
import { displayStatus, type DisplayStatus } from '../../ui/model/status';
import type { SceneCluster, SceneRoom } from './scene';

/** Finished subagents listed per orchestrator; older ones are counted only. */
export const MAX_PANEL_FINISHED = 12;

export interface PanelSub {
  id: string;
  name: string;
  /** The subagent type ("Explore"). */
  type: string;
  task: string;
  status: DisplayStatus;
  startedAt: number;
  /** Set for a finished one: its run time is `finishedAt - startedAt`. */
  finishedAt?: number;
}

export interface PanelOrchestrator {
  id: string;
  name: string;
  status: DisplayStatus;
  codex: boolean;
  /** When the session started. */
  startedAt: number;
  /** When the current turn (or wait) started; null while idle or ended. */
  turnSince: number | null;
  model?: string;
  branch?: string;
  tokensIn: number;
  tokensOut: number;
  costUSD?: number;
  toolCalls: number;
  /** Subagents it launched in the whole session. */
  delegated: number;
  active: readonly PanelSub[];
  finished: readonly PanelSub[];
  /** Finished subagents beyond the listed ones. */
  moreFinished: number;
}

export interface RoomPanelModel {
  roomId: string;
  name: string;
  seed: number;
  git?: ProjectGit;
  orchestrators: readonly PanelOrchestrator[];
  /** The orchestrator the panel shows and the prompt goes to. */
  selectedId: string | null;
}

function subOf(agent: Agent, finishedAt: number | undefined): PanelSub {
  return {
    id: agent.id,
    name: agent.name,
    type: agentRole(agent),
    task: agentTitle(agent)?.trim() ?? '',
    status: finishedAt === undefined ? displayStatus(agent) : 'done',
    startedAt: agent.startedAt,
    ...(finishedAt !== undefined ? { finishedAt } : {}),
  };
}

function orchestratorOf(cluster: SceneCluster, git: ProjectGit | undefined): PanelOrchestrator {
  const main = cluster.main;
  const status = displayStatus(main);
  const running = cluster.subs.filter((sub) => sub.finishedAt === undefined);
  const finished = [
    ...cluster.subs.flatMap((sub) => (sub.finishedAt === undefined ? [] : [subOf(sub.agent, sub.finishedAt)])),
    ...cluster.collapsed.map((entry) => subOf(entry.agent, entry.finishedAt)),
  ].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  const branch = main.gitBranch ?? git?.branch ?? git?.head;
  const busy = status === 'working' || status === 'waiting' || status === 'shell';
  return {
    id: main.id,
    name: main.name,
    status,
    codex: isCodex(main),
    startedAt: main.startedAt,
    turnSince: busy ? main.statusSince : null,
    ...(main.model !== undefined ? { model: main.model } : {}),
    ...(branch !== undefined ? { branch } : {}),
    tokensIn: main.stats.tokensIn,
    tokensOut: main.stats.tokensOut,
    ...(main.stats.costUSD !== undefined ? { costUSD: main.stats.costUSD } : {}),
    toolCalls: main.stats.toolCalls,
    delegated: Math.max(main.stats.subagents, running.length + finished.length),
    active: running.map((sub) => subOf(sub.agent, undefined)),
    finished: finished.slice(0, MAX_PANEL_FINISHED),
    moreFinished: Math.max(0, finished.length - MAX_PANEL_FINISHED),
  };
}

/** Busy orchestrators first is how the panel picks one when the user has not. */
function preferred(orchestrators: readonly PanelOrchestrator[]): PanelOrchestrator | undefined {
  return (
    orchestrators.find((one) => one.status === 'waiting') ??
    orchestrators.find((one) => one.status === 'working' || one.status === 'shell') ??
    orchestrators[0]
  );
}

export function roomPanelModel(room: SceneRoom | undefined, chosenId: string | null): RoomPanelModel | null {
  if (room === undefined) return null;
  const orchestrators = room.clusters.map((cluster) => orchestratorOf(cluster, room.project.git));
  const chosen = orchestrators.find((one) => one.id === chosenId) ?? preferred(orchestrators);
  return {
    roomId: room.project.id,
    name: room.project.name,
    seed: room.project.seed,
    ...(room.project.git !== undefined ? { git: room.project.git } : {}),
    orchestrators,
    selectedId: chosen?.id ?? null,
  };
}
