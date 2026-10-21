// Defensive parsing of GET /api/timelapse: anything unreadable is dropped, nothing is trusted, indexes are checked.
import {
  TIMELAPSE_MAX_AGENTS,
  TIMELAPSE_MAX_EVENTS,
  type ActivityKind,
  type Msg,
  type MsgParam,
  type Timelapse,
  type TimelapseAgent,
  type TimelapseEvent,
  type TimelapseProject,
  type TimelapseStatus,
  type TimelapseTask,
} from '@ai-office/shared';
import { t } from '../i18n';
import { isRecord } from './parse';

const TEXT_MAX = 400;
const MSG_DEPTH = 3;
const STATUSES: ReadonlySet<string> = new Set(['working', 'waiting', 'idle']);
const TASK_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed']);
const OUTCOMES: ReadonlySet<string> = new Set(['passed', 'failed', 'unknown']);
const KINDS: ReadonlySet<string> = new Set(['prompt', 'think', 'reply', 'read', 'search', 'edit', 'write', 'bash', 'web', 'task', 'subagent', 'mcp', 'question', 'permission', 'message', 'error', 'done', 'other']);

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, TEXT_MAX) : fallback;
}

function time(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function message(value: unknown, depth = MSG_DEPTH): Msg | undefined {
  if (!isRecord(value) || typeof value.key !== 'string' || value.key.length > 100) return undefined;
  if (!isRecord(value.params) || depth <= 0) return { key: value.key };
  const params: Record<string, MsgParam> = {};
  for (const [name, param] of Object.entries(value.params)) {
    if (typeof param === 'number' && Number.isFinite(param)) params[name] = param;
    else if (typeof param === 'string') params[name] = param.slice(0, TEXT_MAX);
    else {
      const nested = message(param, depth - 1);
      if (nested !== undefined) params[name] = nested;
    }
  }
  return { key: value.key, params };
}

const withMsg = <K extends string>(name: K, value: unknown): Partial<Record<K, Msg>> => {
  const parsed = message(value);
  return parsed === undefined ? {} : ({ [name]: parsed } as Partial<Record<K, Msg>>);
};

function task(value: unknown): TimelapseTask | undefined {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.status !== 'string' || !TASK_STATUSES.has(value.status)) return undefined;
  return {
    title: str(value.title),
    ...withMsg('titleMsg', value.titleMsg),
    ...(typeof value.activeForm === 'string' ? { activeForm: str(value.activeForm) } : {}),
    ...withMsg('activeFormMsg', value.activeFormMsg),
    status: value.status as TimelapseTask['status'],
  };
}

function project(value: unknown): TimelapseProject | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  return { id: str(value.id), name: str(value.name), order: count(value.order), seed: count(value.seed) };
}

function agent(value: unknown): TimelapseAgent | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || (value.kind !== 'main' && value.kind !== 'sub')) return undefined;
  const recorded = isRecord(value.recordedMs) ? value.recordedMs : undefined;
  return {
    id: str(value.id),
    kind: value.kind,
    ...(typeof value.parentId === 'string' ? { parentId: str(value.parentId) } : {}),
    name: str(value.name),
    role: str(value.role),
    ...withMsg('roleMsg', value.roleMsg),
    ...(typeof value.title === 'string' ? { title: str(value.title) } : {}),
    ...withMsg('titleMsg', value.titleMsg),
    accountId: str(value.accountId),
    projectId: str(value.projectId),
    look: value.look === 'm' ? 'm' : 'f',
    seed: count(value.seed),
    ...(recorded !== undefined ? { recordedMs: { working: count(recorded.working), waiting: count(recorded.waiting), idle: count(recorded.idle) } } : {}),
  };
}

type Reader = (item: Record<string, unknown>, at: number) => TimelapseEvent | undefined;

function readers(agents: number, projects: number): Readonly<Record<string, Reader>> {
  const who = (item: Record<string, unknown>): number | undefined => (typeof item.agent === 'number' && Number.isInteger(item.agent) && item.agent >= 0 && item.agent < agents ? item.agent : undefined);
  return {
    arrive: (item, at) => {
      const a = who(item);
      return a === undefined ? undefined : { at, type: 'arrive', agent: a };
    },
    leave: (item, at) => {
      const a = who(item);
      return a === undefined ? undefined : { at, type: 'leave', agent: a };
    },
    status: (item, at) => {
      const a = who(item);
      if (a === undefined || typeof item.status !== 'string' || !STATUSES.has(item.status)) return undefined;
      return { at, type: 'status', agent: a, status: item.status as TimelapseStatus, ...(typeof item.waitingFor === 'string' ? { waitingFor: str(item.waitingFor) } : {}), ...withMsg('waitingForMsg', item.waitingForMsg) };
    },
    activity: (item, at) => {
      const a = who(item);
      const msg = message(item.msg);
      if (a === undefined || msg === undefined || typeof item.kind !== 'string' || !KINDS.has(item.kind)) return undefined;
      return { at, type: 'activity', agent: a, kind: item.kind as ActivityKind, icon: str(item.icon), text: str(item.text), msg, ...(item.error === true ? { error: true } : {}) };
    },
    tasks: (item, at) => {
      const a = who(item);
      if (a === undefined || !Array.isArray(item.tasks)) return undefined;
      return { at, type: 'tasks', agent: a, tasks: item.tasks.flatMap((entry) => task(entry) ?? []) };
    },
    shell: (item, at) => {
      const a = who(item);
      if (a === undefined || typeof item.id !== 'string' || typeof item.on !== 'boolean') return undefined;
      return { at, type: 'shell', agent: a, on: item.on, id: str(item.id), background: item.background === true, ...(typeof item.label === 'string' ? { label: str(item.label) } : {}), ...withMsg('labelMsg', item.labelMsg) };
    },
    permission: (item, at) => {
      const a = who(item);
      return a === undefined ? undefined : { at, type: 'permission', agent: a, tool: str(item.tool), durationMs: count(item.durationMs) };
    },
    commit: (item, at) => {
      if (typeof item.project !== 'number' || !Number.isInteger(item.project) || item.project < 0 || item.project >= projects || typeof item.hash !== 'string') return undefined;
      const a = who(item);
      return { at, type: 'commit', project: item.project, ...(a !== undefined ? { agent: a } : {}), hash: str(item.hash), subject: str(item.subject), ...(typeof item.branch === 'string' ? { branch: str(item.branch) } : {}) };
    },
    test: (item, at) => {
      const a = who(item);
      if (a === undefined || typeof item.outcome !== 'string' || !OUTCOMES.has(item.outcome)) return undefined;
      const passed = count(item.passed);
      const failed = count(item.failed);
      return { at, type: 'test', agent: a, runner: str(item.runner, 'test'), outcome: item.outcome as 'passed' | 'failed' | 'unknown', ...(passed > 0 ? { passed } : {}), ...(failed > 0 ? { failed } : {}) };
    },
  };
}

function events(value: unknown, agents: number, projects: number): TimelapseEvent[] {
  if (!Array.isArray(value)) return [];
  const read = readers(agents, projects);
  const parsed: TimelapseEvent[] = [];
  for (const item of value.slice(0, TIMELAPSE_MAX_EVENTS)) {
    if (!isRecord(item) || typeof item.type !== 'string') continue;
    const at = time(item.at);
    const reader = read[item.type];
    const event = at === undefined || reader === undefined ? undefined : reader(item, at);
    if (event === undefined) continue;
    parsed.push(event);
  }
  // The server sends them in order; a stray out-of-order event would break the searches, so order them anyway.
  return parsed.every((event, i) => i === 0 || event.at >= (parsed[i - 1] as TimelapseEvent).at) ? parsed : parsed.sort((a, b) => a.at - b.at);
}

/** Events point at agents and projects by position, so a list with an unreadable entry cannot be used at all. */
function positional<T>(value: unknown, read: (item: unknown) => T | undefined, max: number): T[] {
  if (!Array.isArray(value)) return [];
  const items = value.slice(0, max).map(read);
  if (items.some((item) => item === undefined)) throw new Error(t('error.invalidResponse'));
  return items as T[];
}

export function parseTimelapse(data: unknown): Timelapse {
  if (!isRecord(data) || typeof data.date !== 'string') throw new Error(t('error.invalidResponse'));
  const agents = positional(data.agents, agent, TIMELAPSE_MAX_AGENTS);
  const projects = positional(data.projects, project, TIMELAPSE_MAX_AGENTS);
  const from = time(data.from);
  const to = time(data.to);
  return {
    date: str(data.date),
    generatedAt: count(data.generatedAt),
    account: str(data.account, 'all'),
    start: count(data.start),
    end: count(data.end),
    ...(from !== undefined && to !== undefined && to >= from ? { from, to } : {}),
    projects,
    agents,
    events: events(data.events, agents.length, projects.length),
    ...(data.truncated === true ? { truncated: true } : {}),
    ...(data.trimmed === true ? { trimmed: true } : {}),
    ...(data.demo === true ? { demo: true } : {}),
  };
}
