// The replay engine: turns a day's time-lapse and an instant into the same OfficeSnapshot the live stream delivers, so
// the world renderers need no special case. Pure: the state at any instant is computed from the events alone (binary
// searches over per-agent tracks), so seeking is as cheap and as deterministic as playing.
import type { Account, Activity, Agent, AgentStatus, FeedItem, OfficeMeta, OfficeSnapshot, Project, ShellJob, TaskItem, Timelapse, TimelapseAgent, TimelapseEvent, TimelapseStatus } from '@ai-office/shared';

const RECENT_LIMIT = 30;
/** Activity kinds that are a tool call (for the count shown in the agent's data). */
const TOOL_KINDS: ReadonlySet<string> = new Set(['read', 'search', 'edit', 'write', 'bash', 'web', 'task', 'subagent', 'mcp', 'question', 'other']);

interface Span {
  from: number;
  /** Exclusive; Infinity while the person is still in the office when the replay ends. */
  to: number;
}

interface StatusPoint {
  at: number;
  status: TimelapseStatus;
  waitingFor?: string;
  waitingForMsg?: Agent['waitingForMsg'];
}

interface ShellSpan {
  job: ShellJob;
  from: number;
  to: number;
}

interface TaskPoint {
  at: number;
  tasks: TaskItem[];
}

/** Everything one person did in the day, in the order it happened. */
export interface ReplayTrack {
  agent: TimelapseAgent;
  presence: readonly Span[];
  statuses: readonly StatusPoint[];
  activities: readonly Activity[];
  /** Tool calls up to and including the activity at the same position. */
  toolCalls: readonly number[];
  tasks: readonly TaskPoint[];
  shells: readonly ShellSpan[];
  /** When each subagent of this person arrived. */
  spawns: readonly { at: number }[];
}

export interface ReplayEntry {
  at: number;
  track: number;
  activity: Activity;
}

export interface ReplayIndex {
  timelapse: Timelapse;
  tracks: readonly ReplayTrack[];
  /** Every activity of the day, by time. */
  feed: readonly ReplayEntry[];
}

// ---- searching ---------------------------------------------------------------------------------------------------

/** The number of items whose `at` is at or before `t` (the items must be ordered by `at`). */
export function countUpTo(items: readonly { at: number }[], t: number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((items[middle] as { at: number }).at <= t) low = middle + 1;
    else high = middle;
  }
  return low;
}

// ---- building ----------------------------------------------------------------------------------------------------

function presenceOf(events: readonly TimelapseEvent[], agent: number): Span[] {
  const spans: Span[] = [];
  let from: number | undefined;
  for (const event of events) {
    if (event.type === 'commit' || event.agent !== agent) continue;
    if (event.type === 'arrive' && from === undefined) from = event.at;
    else if (event.type === 'leave' && from !== undefined) {
      spans.push({ from, to: event.at });
      from = undefined;
    }
  }
  if (from !== undefined) spans.push({ from, to: Number.POSITIVE_INFINITY });
  return spans;
}

/** The task list with the moment each task entered its status (the board shows it as the card's age). */
function stampTasks(previous: readonly TaskItem[], event: Extract<TimelapseEvent, { type: 'tasks' }>, agentIndex: number): TaskItem[] {
  return event.tasks.map((task, position): TaskItem => {
    const before = previous.find((candidate) => candidate.title === task.title);
    const unchanged = before !== undefined && before.status === task.status;
    return {
      id: `${agentIndex}:${position}:${task.title}`,
      title: task.title,
      ...(task.titleMsg !== undefined ? { titleMsg: task.titleMsg } : {}),
      ...(task.activeForm !== undefined ? { activeForm: task.activeForm } : {}),
      ...(task.activeFormMsg !== undefined ? { activeFormMsg: task.activeFormMsg } : {}),
      status: task.status,
      changedAt: unchanged && before.changedAt !== undefined ? before.changedAt : event.at,
    };
  });
}

function buildTrack(timelapse: Timelapse, index: number): ReplayTrack {
  const agent = timelapse.agents[index] as TimelapseAgent;
  const mine = timelapse.events.filter((event) => event.type !== 'commit' && event.agent === index);
  const statuses: StatusPoint[] = [];
  const activities: Activity[] = [];
  const toolCalls: number[] = [];
  const tasks: TaskPoint[] = [];
  const shells: ShellSpan[] = [];
  const openShells = new Map<string, ShellSpan>();
  let calls = 0;
  for (const event of mine) {
    switch (event.type) {
      case 'status':
        statuses.push({ at: event.at, status: event.status, ...(event.waitingFor !== undefined ? { waitingFor: event.waitingFor } : {}), ...(event.waitingForMsg !== undefined ? { waitingForMsg: event.waitingForMsg } : {}) });
        break;
      case 'activity':
        activities.push({ id: `${agent.id}#${activities.length + 1}`, at: event.at, kind: event.kind, icon: event.icon, text: event.text, msg: event.msg, ...(event.error === true ? { error: true } : {}) });
        if (TOOL_KINDS.has(event.kind)) calls++;
        toolCalls.push(calls);
        break;
      case 'tasks':
        tasks.push({ at: event.at, tasks: stampTasks(tasks[tasks.length - 1]?.tasks ?? [], event, index) });
        break;
      case 'shell':
        if (event.on) {
          const job: ShellJob = { id: event.id, label: event.label ?? '', ...(event.labelMsg !== undefined ? { labelMsg: event.labelMsg } : {}), background: event.background, kind: 'shell', startedAt: event.at };
          const span: ShellSpan = { job, from: event.at, to: Number.POSITIVE_INFINITY };
          openShells.set(event.id, span);
          shells.push(span);
        } else {
          const open = openShells.get(event.id);
          if (open !== undefined) {
            open.to = event.at;
            openShells.delete(event.id);
          }
        }
        break;
      default:
        break;
    }
  }
  const spawns = timelapse.events.filter((event) => event.type === 'arrive' && timelapse.agents[event.agent]?.parentId === agent.id).map((event) => ({ at: event.at }));
  return { agent, presence: presenceOf(timelapse.events, index), statuses, activities, toolCalls, tasks, shells, spawns };
}

export function buildReplay(timelapse: Timelapse): ReplayIndex {
  const tracks = timelapse.agents.map((_, index) => buildTrack(timelapse, index));
  const feed = tracks.flatMap((track, position) => track.activities.map((activity): ReplayEntry => ({ at: activity.at, track: position, activity }))).sort((a, b) => a.at - b.at || a.track - b.track);
  return { timelapse, tracks, feed };
}

// ---- the state at an instant -------------------------------------------------------------------------------------

function spanAt(spans: readonly Span[], t: number): Span | undefined {
  for (const span of spans) if (t >= span.from && t < span.to) return span;
  return undefined;
}

function agentAt(track: ReplayTrack, span: Span, t: number): Agent {
  const info = track.agent;
  const statusAt = countUpTo(track.statuses, t);
  const point = statusAt > 0 ? track.statuses[statusAt - 1] : undefined;
  const status: AgentStatus = point !== undefined && point.at >= span.from ? point.status : info.kind === 'sub' ? 'working' : 'idle';
  const seen = countUpTo(track.activities, t);
  const firstRecent = Math.max(0, seen - RECENT_LIMIT);
  const recent = track.activities.slice(firstRecent, seen).filter((activity) => activity.at >= span.from);
  const activity = recent[recent.length - 1];
  const taskAt = countUpTo(track.tasks, t);
  const tasks = taskAt > 0 ? ((track.tasks[taskAt - 1] as TaskPoint).tasks) : [];
  const shells = track.shells.filter((shell) => t >= shell.from && t < shell.to).map((shell) => shell.job);
  const lastEventAt = Math.max(span.from, point?.at ?? 0, activity?.at ?? 0);
  return {
    id: info.id,
    kind: info.kind,
    sessionId: info.id.split(':')[1] ?? info.id,
    accountId: info.accountId,
    projectId: info.projectId,
    ...(info.parentId !== undefined ? { parentId: info.parentId } : {}),
    name: info.name,
    role: info.role,
    ...(info.roleMsg !== undefined ? { roleMsg: info.roleMsg } : {}),
    ...(info.title !== undefined ? { title: info.title } : {}),
    ...(info.titleMsg !== undefined ? { titleMsg: info.titleMsg } : {}),
    look: info.look,
    seed: info.seed,
    status,
    statusSince: point !== undefined && point.at >= span.from ? point.at : span.from,
    ...(activity !== undefined ? { activity } : {}),
    recent,
    tasks: [...tasks],
    shells,
    stats: {
      toolCalls: seen > 0 ? (track.toolCalls[seen - 1] as number) : 0,
      tokensIn: 0,
      tokensOut: 0,
      linesAdded: 0,
      linesRemoved: 0,
      subagents: countUpTo(track.spawns, t),
    },
    ...(status === 'waiting' && point?.waitingFor !== undefined ? { waitingFor: point.waitingFor } : {}),
    ...(status === 'waiting' && point?.waitingForMsg !== undefined ? { waitingForMsg: point.waitingForMsg } : {}),
    startedAt: span.from,
    lastEventAt,
  };
}

export interface SnapshotContext {
  accounts: readonly Account[];
  meta: OfficeMeta;
  /** Increases on every snapshot the world receives. */
  rev: number;
}

/** The office at instant `t`: whoever is in it, and the rooms they work in. */
export function snapshotAt(index: ReplayIndex, t: number, context: SnapshotContext): OfficeSnapshot {
  const agents: Agent[] = [];
  const rooms = new Set<string>();
  index.tracks.forEach((track) => {
    const span = spanAt(track.presence, t);
    if (span === undefined) return;
    agents.push(agentAt(track, span, t));
    rooms.add(track.agent.projectId);
  });
  const projects: Project[] = index.timelapse.projects.filter((project) => rooms.has(project.id)).map((project) => ({ id: project.id, name: project.name, path: project.id, seed: project.seed, order: project.order }));
  return {
    rev: context.rev,
    serverTime: t,
    meta: context.meta,
    accounts: [...context.accounts],
    projects,
    agents,
    usage: [],
  };
}

/** The last activities up to `t`, oldest first, as the feed shows them. */
export function feedAt(index: ReplayIndex, t: number, limit: number): FeedItem[] {
  const end = countUpTo(index.feed, t);
  return index.feed.slice(Math.max(0, end - limit), end).map((entry) => {
    const agent = (index.tracks[entry.track] as ReplayTrack).agent;
    return { id: entry.activity.id, agentId: agent.id, agentName: agent.name, projectId: agent.projectId, activity: entry.activity };
  });
}

/** People in the office at `t`, for the readout of the controls. */
export function presentCount(index: ReplayIndex, t: number): number {
  return index.tracks.filter((track) => spanAt(track.presence, t) !== undefined).length;
}
