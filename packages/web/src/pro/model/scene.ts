// What the canvas shows, built from the office snapshot: the orchestrators of every room with their subagents. The
// server drops a finished subagent a few seconds after it ends, so the scene keeps a memory of them: a finished
// subagent stays on the canvas, faded, for a while (and no more than a few at a time), then folds into the
// orchestrator's "done" pill. Subagents keep their slot while they are on the canvas. Pure: `buildScene` takes the
// previous memory and returns the next.
import type { Agent, OfficeSnapshot, Project } from '@ai-office/shared';
import { sidebarOrder } from '../../layout/arrange';
import type { LayoutCluster, LayoutRoom } from './layout';
import { MAX_SLOTS, rowsForSlot } from './slots';

/** How long a finished subagent stays on the canvas before it folds into the pill. */
export const FINISHED_FADE_MS = 5 * 60_000;
/** Finished subagents on the canvas per orchestrator; older ones fold into the pill early. */
export const MAX_VISIBLE_FINISHED = 4;
/** Subagents the pill remembers per orchestrator. */
export const MAX_COLLAPSED = 40;

export interface FinishedSub {
  /** The last thing known about it, with the status 'done'. */
  agent: Agent;
  finishedAt: number;
}

export interface ClusterMemory {
  /** Slot of every subagent on the canvas (running or finished). */
  slots: Readonly<Record<string, number>>;
  /** The subagents seen running last time, to notice when one disappears from the snapshot. */
  known: Readonly<Record<string, Agent>>;
  /** Finished subagents still on the canvas. */
  finished: Readonly<Record<string, FinishedSub>>;
  /** Folded into the pill, newest first. */
  collapsed: readonly FinishedSub[];
  /** The most rows of subagents the cluster has needed: what it reserves in the layout. */
  rows: number;
}

export type SceneMemory = ReadonlyMap<string, ClusterMemory>;

export const EMPTY_MEMORY: SceneMemory = new Map();

const EMPTY_CLUSTER: ClusterMemory = { slots: {}, known: {}, finished: {}, collapsed: [], rows: 0 };

export interface SceneSub {
  agent: Agent;
  slot: number;
  /** Set when it already finished: it is drawn faded. */
  finishedAt?: number;
}

/** The squad of a terminal, when it still has others with it. */
export interface SceneSquad {
  id: string;
  members: readonly Agent[];
  /** The member this block shows. */
  currentId: string;
  /** One block, or each member in its own. */
  folded: boolean;
}

export interface SceneCluster {
  main: Agent;
  subs: readonly SceneSub[];
  collapsed: readonly FinishedSub[];
  layout: LayoutCluster;
  squad?: SceneSquad;
}

export interface SceneRoom {
  project: Project;
  clusters: readonly SceneCluster[];
}

export interface Scene {
  rooms: readonly SceneRoom[];
  memory: SceneMemory;
}

function byStart(a: Agent, b: Agent): number {
  return a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function lowestFreeSlot(used: ReadonlySet<number>): number {
  const limit = MAX_SLOTS;
  for (let slot = 0; slot < limit; slot++) if (!used.has(slot)) return slot;
  return limit - 1;
}

/** A subagent that already finished: the server says `done` while it still shows it. */
function isFinished(agent: Agent): boolean {
  return agent.status === 'done' || agent.status === 'offline';
}

function asDone(agent: Agent, at: number): Agent {
  return agent.status === 'done' ? agent : { ...agent, status: 'done', statusSince: at, permission: undefined };
}

function advanceCluster(
  prev: ClusterMemory,
  subs: readonly Agent[],
  now: number,
): { memory: ClusterMemory; running: Agent[] } {
  const collapsedIds = new Set(prev.collapsed.map((entry) => entry.agent.id));
  const live = new Map(subs.filter((sub) => !collapsedIds.has(sub.id)).map((sub) => [sub.id, sub]));
  const finished = new Map(Object.entries(prev.finished));

  const running: Agent[] = [];
  for (const sub of live.values()) {
    if (isFinished(sub))
      finished.set(sub.id, { agent: sub, finishedAt: finished.get(sub.id)?.finishedAt ?? sub.statusSince });
    else {
      finished.delete(sub.id);
      running.push(sub);
    }
  }
  // Gone from the snapshot without a "done" in between: it finished now.
  for (const [id, agent] of Object.entries(prev.known)) {
    if (live.has(id) || finished.has(id) || collapsedIds.has(id)) continue;
    finished.set(id, { agent: asDone(agent, now), finishedAt: now });
  }

  const ordered = [...finished.values()].sort((a, b) => b.finishedAt - a.finishedAt);
  const visible = ordered.filter(
    (entry, index) => index < MAX_VISIBLE_FINISHED && now - entry.finishedAt < FINISHED_FADE_MS,
  );
  const visibleIds = new Set(visible.map((entry) => entry.agent.id));
  const folded = ordered.filter((entry) => !visibleIds.has(entry.agent.id));
  const collapsed = [...folded, ...prev.collapsed].slice(0, MAX_COLLAPSED);

  const onCanvas = new Set([...running.map((sub) => sub.id), ...visibleIds]);
  const slots: Record<string, number> = {};
  const used = new Set<number>();
  const assign = (id: string): void => {
    const slot = prev.slots[id] ?? lowestFreeSlot(used);
    slots[id] = slot;
    used.add(slot);
  };
  // Those that already have a slot keep it before newcomers pick one.
  for (const id of onCanvas) if (prev.slots[id] !== undefined) assign(id);
  for (const id of [...running.map((sub) => sub.id), ...visible.map((entry) => entry.agent.id)])
    if (slots[id] === undefined) assign(id);
  const highest = Object.values(slots).reduce((max, slot) => Math.max(max, slot), -1);
  const memory: ClusterMemory = {
    slots,
    known: Object.fromEntries(running.map((sub) => [sub.id, sub])),
    finished: Object.fromEntries(visible.map((entry) => [entry.agent.id, entry])),
    collapsed,
    rows: highest < 0 ? prev.rows : Math.max(prev.rows, rowsForSlot(highest)),
  };
  return { memory, running };
}

/** The subagents that belong to an orchestrator: by `parentId`, or by being in the same session. */
function subsOf(main: Agent, subs: readonly Agent[]): Agent[] {
  return subs.filter(
    (sub) =>
      sub.parentId === main.id ||
      (sub.parentId === undefined && sub.sessionId === main.sessionId && sub.accountId === main.accountId),
  );
}

export function buildScene(snapshot: OfficeSnapshot, memory: SceneMemory, now: number): Scene {
  const projects = new Map(snapshot.projects.map((project) => [project.id, project]));
  const mains = snapshot.agents.filter((agent) => agent.kind === 'main').sort(byStart);
  const subs = snapshot.agents.filter((agent) => agent.kind === 'sub');
  const nextMemory = new Map<string, ClusterMemory>();
  const rooms: SceneRoom[] = [];

  for (const projectId of sidebarOrder(snapshot.projects)) {
    const project = projects.get(projectId);
    if (project === undefined) continue;
    const clusters: SceneCluster[] = [];
    for (const main of mains.filter((agent) => agent.projectId === projectId)) {
      const { memory: next, running } = advanceCluster(memory.get(main.id) ?? EMPTY_CLUSTER, subsOf(main, subs), now);
      nextMemory.set(main.id, next);
      const sceneSubs: SceneSub[] = [
        ...running.map((agent) => ({ agent, slot: next.slots[agent.id] as number })),
        ...Object.values(next.finished).map((entry) => ({
          agent: entry.agent,
          slot: next.slots[entry.agent.id] as number,
          finishedAt: entry.finishedAt,
        })),
      ].sort((a, b) => a.slot - b.slot);
      clusters.push({
        main,
        subs: sceneSubs,
        collapsed: next.collapsed,
        layout: { id: main.id, rows: next.rows, slots: next.slots },
      });
    }
    if (clusters.length > 0) rooms.push({ project, clusters });
  }
  return { rooms, memory: nextMemory };
}

/** The layout's view of the scene. */
export function layoutRooms(scene: Scene): LayoutRoom[] {
  return scene.rooms.map((room) => ({ id: room.project.id, clusters: room.clusters.map((cluster) => cluster.layout) }));
}
