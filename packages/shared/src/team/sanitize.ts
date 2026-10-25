// What leaves this computer in team mode. `buildTeamShare` is the single place that turns the office into the share;
// it builds the result field by field from an allowlist, so a field added to Agent or Project later can never leak.
// Always shared: the display name, the status, the kind of activity, how long ago the status began, which CLI, the look.
// Never shared: paths, prompts, commands, file names, branches, costs, tokens, session ids, accounts, tasks, permission
// requests, messages, git state, the folder name behind a room alias. Opt-in, per category and off by default: room
// names, the activity in words, titles, branches, tokens and cost.
import type { Agent, Project } from '../model';
import type { Msg } from '../i18n/i18n';
import { cleanLine } from './text';
import {
  TEAM_MAX_AGENTS,
  TEAM_MAX_ROOMS,
  TEAM_NAME_MAX,
  TEAM_TEXT_MAX,
  type SharedAgent,
  type SharedRoom,
  type SharedStatus,
  type TeamShare,
  type TeamSharePrefs,
} from './types';

export interface ShareSource {
  projects: readonly Project[];
  agents: readonly Agent[];
}

/** Keyed, one-way and stable on one device: `kind` is 'agent' or 'room'. */
export type ShareKey = (kind: 'agent' | 'room', id: string) => string;

const SHARED_STATUSES: ReadonlySet<string> = new Set<SharedStatus>(['working', 'waiting', 'idle']);
const MAX_BRANCH = 60;
const MAX_MSG_PARAMS = 8;
const MSG_KEY = /^[a-z][a-zA-Z0-9.]{0,63}$/;

/** A message whose parameters are all plain text or numbers, cleaned; undefined when it cannot be kept whole. */
export function flatMsg(msg: unknown): Msg | undefined {
  if (typeof msg !== 'object' || msg === null) return undefined;
  const { key, params } = msg as { key?: unknown; params?: unknown };
  if (typeof key !== 'string' || !MSG_KEY.test(key)) return undefined;
  if (params === undefined) return { key };
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return undefined;
  const entries = Object.entries(params as Record<string, unknown>);
  if (entries.length > MAX_MSG_PARAMS) return undefined;
  const out: Record<string, string | number> = {};
  for (const [name, value] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,23}$/.test(name)) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
    else if (typeof value === 'string') out[name] = cleanLine(value, TEAM_TEXT_MAX) ?? '';
    else return undefined;
  }
  return { key, params: out };
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function shareAgent(agent: Agent, roomKey: string, prefs: TeamSharePrefs, now: number, key: ShareKey): SharedAgent {
  const out: SharedAgent = {
    key: key('agent', agent.id),
    name: cleanLine(agent.name, TEAM_NAME_MAX) ?? '?',
    roomKey,
    kind: agent.kind === 'sub' ? 'sub' : 'main',
    status: agent.status as SharedStatus,
    sinceAgeMs: Math.max(0, Math.round(now - agent.statusSince)),
    look: agent.look === 'm' ? 'm' : 'f',
  };
  if (agent.appearance !== undefined) out.appearance = agent.appearance;
  if (agent.source === 'codex') out.source = 'codex';
  if (agent.activity !== undefined) out.activityKind = agent.activity.kind;
  if (prefs.activityText && agent.activity !== undefined) {
    const text = cleanLine(agent.activity.text, TEAM_TEXT_MAX);
    if (text !== undefined) out.activityText = text;
    const msg = flatMsg(agent.activity.msg);
    if (msg !== undefined) out.activityMsg = msg;
  }
  if (prefs.titles) {
    const title = cleanLine(agent.title, TEAM_TEXT_MAX);
    if (title !== undefined) out.title = title;
  }
  if (prefs.branches) {
    const branch = cleanLine(agent.gitBranch, MAX_BRANCH);
    if (branch !== undefined) out.branch = branch;
  }
  if (prefs.usage) {
    const tokens = finite(agent.stats.tokensIn + agent.stats.tokensOut);
    if (tokens !== undefined) out.tokens = Math.round(tokens);
    const cost = finite(agent.stats.costUSD);
    if (cost !== undefined) out.costUSD = Math.round(cost * 10_000) / 10_000;
  }
  return out;
}

/** The share of this office under these preferences. `now` is this computer's clock; the result carries ages only. */
export function buildTeamShare(source: ShareSource, prefs: TeamSharePrefs, now: number, key: ShareKey): TeamShare {
  if (prefs.paused) return { rooms: [], agents: [], paused: true };
  const eligible = source.agents
    .filter((agent) => SHARED_STATUSES.has(agent.status))
    .sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const projects = new Map(source.projects.map((project) => [project.id, project]));
  const used = [...new Set(eligible.map((agent) => agent.projectId))]
    .map((id) => projects.get(id))
    .filter((project): project is Project => project !== undefined)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, TEAM_MAX_ROOMS);
  const rooms: SharedRoom[] = used.map((project, index) => {
    const room: SharedRoom = { key: key('room', project.id), index: index + 1 };
    if (prefs.projectNames) {
      const name = cleanLine(project.name, TEAM_TEXT_MAX);
      if (name !== undefined) room.name = name;
    }
    return room;
  });
  const roomKeys = new Map(used.map((project, index) => [project.id, (rooms[index] as SharedRoom).key]));
  const agents = eligible
    .flatMap((agent) => {
      const roomKey = roomKeys.get(agent.projectId);
      return roomKey === undefined ? [] : [shareAgent(agent, roomKey, prefs, now, key)];
    })
    .slice(0, TEAM_MAX_AGENTS);
  return { rooms, agents };
}
