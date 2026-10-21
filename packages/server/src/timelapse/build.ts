// Turns the per-file moments of a day into the time-lapse: who was in the office and when, what each one was doing, the
// commits and test runs. Pure: names, recorded status times and Git commits come in through the input.
import {
  type Msg,
  type PersonName,
  type ReportCommit,
  type Timelapse,
  type TimelapseAgent,
  type TimelapseEvent,
  type TimelapseProject,
  type TimelapseStatus,
  TIMELAPSE_IDLE_LEAVE_MS,
  TIMELAPSE_MAX_AGENTS,
  basename,
  compareEvents,
  fnv1a,
  mergeCommits,
  msg,
  sortEvents,
  sourceText,
  truncate,
} from '@ai-office/shared';
import type { SubagentMeta } from '../claude/paths';
import type { FileDay } from '../report/accumulator';
import { maskSecrets } from '../report/commands';
import { fitEvents } from './fit';
import type { FileTrace, TraceEvent, TraceSpan, TraceSpawn } from './recorder';
import { PARAM_MAX } from './sanitize';

/** A subagent that went quiet without a completion notice is gone this long after its last event. */
export const SUB_LEAVE_AFTER_MS = 120_000;
/** The replay runs a little past the last event, so the final state is on screen for a moment. */
export const TAIL_MS = 2 * 60_000;
const MIN_RANGE_MS = 60_000;

export interface TraceFile {
  /** Subagent id; "" for the main transcript. */
  agent: string;
  day: FileDay;
  trace: FileTrace;
  meta?: SubagentMeta;
}

export interface SessionTrace {
  accountId: string;
  sessionId: string;
  files: readonly TraceFile[];
}

export interface BuildInput {
  date: string;
  start: number;
  end: number;
  now: number;
  /** An account id or "all". */
  account: string;
  sessions: readonly SessionTrace[];
  /** The name of an agent id; `taken` holds the names already given in this day. */
  personOf: (agentId: string, taken: ReadonlySet<string>) => PersonName;
  recordedOf: (agentId: string) => TimelapseAgent['recordedMs'] | undefined;
  /** Commits the Git integration saw in a project folder that day. */
  gitCommitsOf: (projectPath: string) => readonly ReportCommit[];
  truncated: boolean;
}

interface Interval {
  from: number;
  /** Undefined: still in the office when the day (or the replay) ends. */
  to: number | undefined;
}

interface Draft {
  id: string;
  kind: 'main' | 'sub';
  parentId?: string;
  accountId: string;
  projectPath: string;
  file: TraceFile;
  spawn?: TraceSpawn;
  intervals: Interval[];
}

function projectOf(files: readonly TraceFile[]): string {
  return (
    files.find((file) => file.agent === '')?.day.cwd ?? files.find((file) => file.day.cwd !== undefined)?.day.cwd ?? ''
  );
}

function mainIntervals(spans: readonly TraceSpan[], input: BuildInput): Interval[] {
  return spans.map((span) => {
    const leaveAt = span.to + TIMELAPSE_IDLE_LEAVE_MS;
    return { from: span.from, to: leaveAt < input.end && leaveAt <= input.now ? leaveAt : undefined };
  });
}

/** The spawn a subagent file belongs to: by the tool call id in its meta, else the closest earlier unclaimed call. */
function spawnOf(file: TraceFile, spawns: readonly TraceSpawn[], claimed: Set<string>): TraceSpawn | undefined {
  const byId =
    file.meta?.toolUseId === undefined ? undefined : spawns.find((spawn) => spawn.toolUseId === file.meta?.toolUseId);
  const first = file.trace.firstAt ?? 0;
  const found =
    byId ?? [...spawns].reverse().find((spawn) => !claimed.has(spawn.toolUseId) && spawn.at <= first + 5000);
  if (found !== undefined) claimed.add(found.toolUseId);
  return found;
}

function subInterval(file: TraceFile, spawn: TraceSpawn | undefined, input: BuildInput): Interval | undefined {
  const firstAt = file.trace.firstAt;
  const lastAt = file.trace.lastAt;
  if (firstAt === undefined || lastAt === undefined) return undefined;
  const from = Math.max(input.start, Math.min(firstAt, spawn?.at ?? firstAt));
  const doneAt = spawn?.doneAt !== undefined ? Math.max(spawn.doneAt, lastAt) : lastAt + SUB_LEAVE_AFTER_MS;
  return { from, to: doneAt < input.end && doneAt <= input.now ? doneAt : undefined };
}

function collectDrafts(input: BuildInput): Draft[] {
  const drafts: Draft[] = [];
  for (const session of input.sessions) {
    const main = session.files.find((file) => file.agent === '');
    if (main === undefined || main.trace.firstAt === undefined) continue;
    const mainId = `${session.accountId}:${session.sessionId}`;
    const projectPath = projectOf(session.files);
    if (projectPath === '') continue;
    drafts.push({
      id: mainId,
      kind: 'main',
      accountId: session.accountId,
      projectPath,
      file: main,
      intervals: mainIntervals(main.trace.spans, input),
    });
    const claimed = new Set<string>();
    const subs = session.files
      .filter((file) => file.agent !== '')
      .sort((a, b) => (a.trace.firstAt ?? 0) - (b.trace.firstAt ?? 0));
    for (const file of subs) {
      const spawn = spawnOf(file, main.trace.spawns, claimed);
      const interval = subInterval(file, spawn, input);
      if (interval === undefined) continue;
      drafts.push({
        id: `${mainId}:${file.agent}`,
        kind: 'sub',
        parentId: mainId,
        accountId: session.accountId,
        projectPath,
        file,
        ...(spawn !== undefined ? { spawn } : {}),
        intervals: [interval],
      });
    }
  }
  return drafts;
}

// ---- one agent's events ------------------------------------------------------------------------------------------

interface StatusPoint {
  at: number;
  status: TimelapseStatus;
  waitingFor?: string;
  waitingForMsg?: Msg;
}

/** The statuses of an agent over the day; a subagent is working whenever it does not wait for the person. */
function statusPoints(draft: Draft): StatusPoint[] {
  const points: StatusPoint[] = [];
  for (const event of draft.file.trace.events) {
    if (event.t !== 'status') continue;
    const status = draft.kind === 'sub' && event.status === 'idle' ? 'working' : event.status;
    const previous = points[points.length - 1];
    if (previous !== undefined && previous.status === status && previous.waitingFor === event.waitingFor) continue;
    points.push({
      at: event.at,
      status,
      ...(event.waitingFor !== undefined ? { waitingFor: event.waitingFor } : {}),
      ...(event.waitingForMsg !== undefined ? { waitingForMsg: event.waitingForMsg } : {}),
    });
  }
  return points;
}

function statusAt(points: readonly StatusPoint[], at: number, kind: Draft['kind']): StatusPoint {
  let found: StatusPoint | undefined;
  for (const point of points) {
    if (point.at > at) break;
    found = point;
  }
  return found ?? { at, status: kind === 'sub' ? 'working' : 'idle' };
}

function statusEvent(index: number, point: StatusPoint, at: number): TimelapseEvent {
  return {
    at,
    type: 'status',
    agent: index,
    status: point.status,
    ...(point.waitingFor !== undefined ? { waitingFor: point.waitingFor } : {}),
    ...(point.waitingForMsg !== undefined ? { waitingForMsg: point.waitingForMsg } : {}),
  };
}

function inInterval(at: number, interval: Interval): boolean {
  return at >= interval.from && (interval.to === undefined || at <= interval.to);
}

function agentEvents(draft: Draft, index: number): TimelapseEvent[] {
  const points = statusPoints(draft);
  const stream = [
    ...draft.file.trace.events.flatMap((event) => mapEvent(event, index)),
    ...points.map((point) => statusEvent(index, point, point.at)),
  ].sort(compareEvents);
  const events: TimelapseEvent[] = [];
  const openShells = new Set<string>();
  for (const interval of draft.intervals) {
    events.push(
      { at: interval.from, type: 'arrive', agent: index },
      statusEvent(index, statusAt(points, interval.from, draft.kind), interval.from),
    );
    for (const event of stream) {
      if (!inInterval(event.at, interval) || (event.type === 'status' && event.at <= interval.from)) continue;
      events.push(event);
      if (event.type === 'shell') {
        if (event.on) openShells.add(event.id);
        else openShells.delete(event.id);
      }
    }
    if (interval.to === undefined) continue;
    for (const id of openShells)
      events.push({ at: interval.to, type: 'shell', agent: index, on: false, id, background: false });
    openShells.clear();
    events.push({ at: interval.to, type: 'leave', agent: index });
  }
  return events;
}

function mapEvent(event: TraceEvent, agent: number): TimelapseEvent[] {
  switch (event.t) {
    case 'activity':
      return [
        {
          at: event.at,
          type: 'activity',
          agent,
          kind: event.kind,
          icon: event.icon,
          text: event.text,
          msg: event.msg,
          ...(event.error === true ? { error: true } : {}),
        },
      ];
    case 'tasks':
      return [{ at: event.at, type: 'tasks', agent, tasks: event.tasks }];
    case 'shell':
      return [
        {
          at: event.at,
          type: 'shell',
          agent,
          on: event.on,
          id: event.id,
          background: event.background,
          ...(event.label !== undefined ? { label: event.label } : {}),
          ...(event.labelMsg !== undefined ? { labelMsg: event.labelMsg } : {}),
        },
      ];
    case 'permission':
      return [{ at: event.at, type: 'permission', agent, tool: event.tool, durationMs: event.durationMs }];
    case 'status':
      return [];
  }
}

// ---- project-wide events -----------------------------------------------------------------------------------------

function testEvents(draft: Draft, index: number): TimelapseEvent[] {
  return draft.file.day.tests.map((run) => ({
    at: run.at,
    type: 'test' as const,
    agent: index,
    runner: run.runner,
    outcome: run.outcome,
    ...(run.passed !== undefined ? { passed: run.passed } : {}),
    ...(run.failed !== undefined ? { failed: run.failed } : {}),
  }));
}

function commitEvents(
  drafts: readonly Draft[],
  indexes: ReadonlyMap<string, number>,
  projects: ReadonlyMap<string, number>,
  input: BuildInput,
): TimelapseEvent[] {
  const events: TimelapseEvent[] = [];
  for (const [path, project] of projects) {
    const agentOf = new Map<ReportCommit, number>();
    const seen: ReportCommit[][] = [];
    for (const draft of drafts) {
      if (draft.projectPath !== path || draft.file.day.commits.length === 0) continue;
      const commits = draft.file.day.commits;
      for (const commit of commits) agentOf.set(commit, indexes.get(draft.id) as number);
      seen.push([...commits]);
    }
    for (const commit of mergeCommits(...seen, input.gitCommitsOf(path))) {
      if (commit.at < input.start || commit.at >= input.end) continue;
      const agent = agentOf.get(commit);
      events.push({
        at: commit.at,
        type: 'commit',
        project,
        ...(agent !== undefined ? { agent } : {}),
        hash: commit.hash,
        subject: truncate(maskSecrets(commit.subject), PARAM_MAX + 40),
        ...(commit.branch !== undefined ? { branch: commit.branch } : {}),
      });
    }
  }
  return events;
}

// ---- the day -----------------------------------------------------------------------------------------------------

function projectsOf(drafts: readonly Draft[], arrivals: ReadonlyMap<string, number>): TimelapseProject[] {
  const paths = [...new Set(drafts.map((draft) => draft.projectPath))].sort(
    (a, b) => (arrivals.get(a) ?? 0) - (arrivals.get(b) ?? 0) || a.localeCompare(b),
  );
  return paths.map((path, order) => ({ id: path, name: basename(path), order, seed: fnv1a(path) }));
}

function identity(draft: Draft, person: PersonName, input: BuildInput): TimelapseAgent {
  const file = draft.file;
  const recorded = input.recordedOf(draft.id);
  const title = draft.kind === 'main' ? file.trace.title : (file.meta?.description ?? draft.spawn?.description);
  const subRole = file.meta?.agentType ?? draft.spawn?.subagentType;
  const role =
    draft.kind === 'main' ? sourceText(msg('agent.role.main')) : (subRole ?? sourceText(msg('agent.role.sub')));
  return {
    id: draft.id,
    kind: draft.kind,
    ...(draft.parentId !== undefined ? { parentId: draft.parentId } : {}),
    name: person.name,
    role,
    ...(draft.kind === 'main'
      ? { roleMsg: msg('agent.role.main') }
      : subRole === undefined
        ? { roleMsg: msg('agent.role.sub') }
        : {}),
    ...(title !== undefined ? { title: truncate(maskSecrets(title), PARAM_MAX) } : {}),
    accountId: draft.accountId,
    projectId: draft.projectPath,
    look: person.look,
    seed: fnv1a(draft.id),
    ...(recorded !== undefined ? { recordedMs: recorded } : {}),
  };
}

function firstArrivals(drafts: readonly Draft[]): Map<string, number> {
  const arrivals = new Map<string, number>();
  for (const draft of drafts) {
    const from = draft.intervals[0]?.from ?? Number.POSITIVE_INFINITY;
    arrivals.set(draft.projectPath, Math.min(arrivals.get(draft.projectPath) ?? from, from));
  }
  return arrivals;
}

export function buildTimelapse(input: BuildInput): Timelapse {
  const base = { date: input.date, generatedAt: input.now, account: input.account, start: input.start, end: input.end };
  const all = collectDrafts(input).sort((a, b) => (a.intervals[0]?.from ?? 0) - (b.intervals[0]?.from ?? 0));
  const mains = new Set(
    all
      .filter((draft) => draft.kind === 'main')
      .slice(0, TIMELAPSE_MAX_AGENTS)
      .map((draft) => draft.id),
  );
  const drafts = all
    .filter((draft) => (draft.kind === 'main' ? mains.has(draft.id) : mains.has(draft.parentId as string)))
    .slice(0, TIMELAPSE_MAX_AGENTS);
  if (drafts.length === 0)
    return { ...base, projects: [], agents: [], events: [], ...(input.truncated ? { truncated: true } : {}) };

  const projects = projectsOf(drafts, firstArrivals(drafts));
  const projectIndex = new Map(projects.map((project, index) => [project.id, index]));
  const taken = new Set<string>();
  const indexes = new Map<string, number>();
  const agents = drafts.map((draft, index) => {
    const person = input.personOf(draft.id, taken);
    taken.add(person.name);
    indexes.set(draft.id, index);
    return identity(draft, person, input);
  });
  const events = drafts.flatMap((draft, index) => [...agentEvents(draft, index), ...testEvents(draft, index)]);
  events.push(...commitEvents(drafts, indexes, projectIndex, input));

  const lastAt = Math.max(...drafts.map((draft) => draft.file.trace.lastAt ?? 0));
  const from = Math.min(...events.map((event) => event.at));
  const to = Math.min(input.end, input.now, Math.max(lastAt + TAIL_MS, from + MIN_RANGE_MS));
  const inRange = sortEvents(events.filter((event) => event.at <= to));
  const fitted = fitEvents(inRange);
  return {
    ...base,
    from,
    to,
    projects,
    agents,
    events: fitted.events,
    ...(input.truncated ? { truncated: true } : {}),
    ...(fitted.trimmed ? { trimmed: true } : {}),
  };
}
