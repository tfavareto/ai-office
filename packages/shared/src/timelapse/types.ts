// Contract of the day time-lapse: everything the page needs to replay a local day of the office at accelerated speed.
// Built by the server from the day's transcripts (see GET /api/timelapse). No message bodies: activities carry a
// localizable text about what the agent was doing (reading a file, running a command), never what was said.
// Every timestamp is epoch milliseconds. Events refer to agents and projects by index into `agents` / `projects`.
import type { Msg } from '../i18n/i18n';
import type { ActivityKind, AgentKind, TaskItem } from '../model';
import type { ReportTestOutcome } from '../report/types';

/** Most events a time-lapse carries; a busier day is thinned (low-value activities first) and flagged `trimmed`. */
export const TIMELAPSE_MAX_EVENTS = 20_000;
/** Most people (main agents and subagents) a time-lapse carries. */
export const TIMELAPSE_MAX_AGENTS = 200;
/** A session with no event for this long has left the office (the same rule the live engine uses without a registry). */
export const TIMELAPSE_IDLE_LEAVE_MS = 30 * 60_000;

/** What an agent is doing: the statuses of a person at the office (`done` and `offline` are arrivals and departures). */
export type TimelapseStatus = 'working' | 'waiting' | 'idle';

export interface TimelapseProject {
  /** The absolute project folder, like `Project.id`. */
  id: string;
  name: string;
  /** Order of first arrival in the day (0 = first room opened); the world maps it to a room slot. */
  order: number;
  seed: number;
}

export interface TimelapseAgent {
  /** Same ids as the live office: `account:session` and `account:session:subagent`. */
  id: string;
  kind: AgentKind;
  parentId?: string;
  name: string;
  /** "Principal" for main agents; the subagent type for subagents. */
  role: string;
  roleMsg?: Msg;
  /** The session's own title or the subagent's task description (never the first prompt). */
  title?: string;
  titleMsg?: Msg;
  accountId: string;
  projectId: string;
  look: 'f' | 'm';
  seed: number;
  /** Time per status the office recorded that day ("Meu dia"), when it was running. */
  recordedMs?: Readonly<Record<TimelapseStatus, number>>;
}

export interface TimelapseTask {
  title: string;
  titleMsg?: Msg;
  activeForm?: string;
  activeFormMsg?: Msg;
  status: TaskItem['status'];
}

interface EventBase {
  at: number;
}

/** A session opened or a subagent was spawned: the person walks in. */
export interface TimelapseArrive extends EventBase {
  type: 'arrive';
  agent: number;
}

/** A session closed (or went quiet for 30 minutes) or a subagent finished: the person walks out. */
export interface TimelapseLeave extends EventBase {
  type: 'leave';
  agent: number;
}

export interface TimelapseStatusChange extends EventBase {
  type: 'status';
  agent: number;
  status: TimelapseStatus;
  /** Why the agent waits ("Aprovar Edit"), only for `waiting`. `waitingFor` is the pt-BR fallback of `waitingForMsg`. */
  waitingFor?: string;
  waitingForMsg?: Msg;
}

/** What the agent started doing. `text` is the pt-BR fallback of `msg`. */
export interface TimelapseActivity extends EventBase {
  type: 'activity';
  agent: number;
  kind: ActivityKind;
  icon: string;
  text: string;
  msg: Msg;
  error?: boolean;
}

/** The agent's task list after a change. */
export interface TimelapseTasks extends EventBase {
  type: 'tasks';
  agent: number;
  tasks: TimelapseTask[];
}

/** A shell command started running (or a background process started) or ended. */
export interface TimelapseShell extends EventBase {
  type: 'shell';
  agent: number;
  on: boolean;
  id: string;
  background: boolean;
  label?: string;
  labelMsg?: Msg;
}

/** The agent waited for the person (a permission, a question): `at` is when the wait began. */
export interface TimelapsePermission extends EventBase {
  type: 'permission';
  agent: number;
  tool: string;
  durationMs: number;
}

export interface TimelapseCommit extends EventBase {
  type: 'commit';
  project: number;
  /** The agent that ran `git commit`; absent for commits only the Git integration saw. */
  agent?: number;
  hash: string;
  subject: string;
  branch?: string;
}

export interface TimelapseTest extends EventBase {
  type: 'test';
  agent: number;
  runner: string;
  outcome: ReportTestOutcome;
  passed?: number;
  failed?: number;
}

export type TimelapseEvent =
  | TimelapseArrive
  | TimelapseLeave
  | TimelapseStatusChange
  | TimelapseActivity
  | TimelapseTasks
  | TimelapseShell
  | TimelapsePermission
  | TimelapseCommit
  | TimelapseTest;

export type TimelapseEventType = TimelapseEvent['type'];

export interface Timelapse {
  /** Local date, YYYY-MM-DD. */
  date: string;
  generatedAt: number;
  /** An account id or "all". */
  account: string;
  /** Local midnights that bound the day. */
  start: number;
  end: number;
  /** The span worth watching: from the first arrival to a little after the last event. Absent on a day without activity. */
  from?: number;
  to?: number;
  projects: TimelapseProject[];
  agents: TimelapseAgent[];
  /** Time ordered. */
  events: TimelapseEvent[];
  /** A scan limit (files, bytes, time) was hit: the day may be incomplete. */
  truncated?: boolean;
  /** The day had more than {@link TIMELAPSE_MAX_EVENTS} events: some low-value activities were left out. */
  trimmed?: boolean;
  demo?: boolean;
}

/** An empty day. */
export function emptyTimelapse(base: Pick<Timelapse, 'date' | 'generatedAt' | 'account' | 'start' | 'end'>): Timelapse {
  return { ...base, projects: [], agents: [], events: [] };
}
