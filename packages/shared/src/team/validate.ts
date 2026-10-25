// Everything that arrives from another machine is untrusted: these readers rebuild the value from an allowlist of fields
// (unknown fields are dropped, never passed on), clean the texts and enforce the caps.
import { parseLook } from '../customization/validate';
import type { ActivityKind } from '../model';
import { flatMsg } from './sanitize';
import { cleanLine, isSafeKey } from './text';
import {
  DEFAULT_TEAM_SHARE,
  TEAM_DEVICE_MAX,
  TEAM_MAX_AGENTS,
  TEAM_MAX_MEMBERS,
  TEAM_MAX_ROOMS,
  TEAM_NAME_MAX,
  TEAM_TEAMNAME_MAX,
  TEAM_TEXT_MAX,
  type SharedAgent,
  type SharedRoom,
  type TeamShare,
  type TeamSharePrefs,
  type TeamViewMember,
  type TeamViewMsg,
} from './types';

const ACTIVITY_KINDS: ReadonlySet<string> = new Set<ActivityKind>([
  'prompt',
  'think',
  'reply',
  'read',
  'search',
  'edit',
  'write',
  'bash',
  'web',
  'task',
  'subagent',
  'mcp',
  'question',
  'permission',
  'message',
  'error',
  'done',
  'other',
]);
const MAX_AGE_MS = 10 * 365 * 24 * 3600 * 1000;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedNumber(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
}

function readRoom(raw: unknown): SharedRoom | undefined {
  const r = record(raw);
  if (r === undefined || !isSafeKey(r.key)) return undefined;
  const index = boundedNumber(r.index, 99);
  if (index === undefined || !Number.isInteger(index) || index < 1) return undefined;
  const name = cleanLine(r.name, TEAM_TEXT_MAX);
  return { key: r.key, index, ...(name !== undefined ? { name } : {}) };
}

function readAgent(raw: unknown, rooms: ReadonlySet<string>): SharedAgent | undefined {
  const r = record(raw);
  if (r === undefined) return undefined;
  if (!isSafeKey(r.key)) return undefined;
  if (!isSafeKey(r.roomKey) || !rooms.has(r.roomKey)) return undefined;
  if (r.status !== 'working' && r.status !== 'waiting' && r.status !== 'idle') return undefined;
  const name = cleanLine(r.name, TEAM_NAME_MAX);
  const since = boundedNumber(r.sinceAgeMs, MAX_AGE_MS);
  if (name === undefined || since === undefined) return undefined;
  const out: SharedAgent = {
    key: r.key,
    name,
    roomKey: r.roomKey,
    kind: r.kind === 'sub' ? 'sub' : 'main',
    status: r.status,
    sinceAgeMs: Math.round(since),
    look: r.look === 'm' ? 'm' : 'f',
  };
  const appearance = parseLook(r.appearance);
  if (appearance !== undefined) out.appearance = appearance;
  if (r.source === 'codex') out.source = 'codex';
  if (typeof r.activityKind === 'string' && ACTIVITY_KINDS.has(r.activityKind))
    out.activityKind = r.activityKind as ActivityKind;
  const text = cleanLine(r.activityText, TEAM_TEXT_MAX);
  if (text !== undefined) out.activityText = text;
  // A message only travels with the words it renders (both are part of "activity in words").
  const msg = text === undefined ? undefined : flatMsg(r.activityMsg);
  if (msg !== undefined) out.activityMsg = msg;
  const title = cleanLine(r.title, TEAM_TEXT_MAX);
  if (title !== undefined) out.title = title;
  const branch = cleanLine(r.branch, 60);
  if (branch !== undefined) out.branch = branch;
  const tokens = boundedNumber(r.tokens, 1e13);
  if (tokens !== undefined) out.tokens = Math.round(tokens);
  const cost = boundedNumber(r.costUSD, 1e7);
  if (cost !== undefined) out.costUSD = cost;
  return out;
}

/** A share from the wire, rebuilt from the allowlist; undefined when it is not a share at all. */
export function parseTeamShare(raw: unknown): TeamShare | undefined {
  const r = record(raw);
  if (r === undefined || !Array.isArray(r.rooms) || !Array.isArray(r.agents)) return undefined;
  if (r.rooms.length > TEAM_MAX_ROOMS * 2 || r.agents.length > TEAM_MAX_AGENTS * 2) return undefined;
  const rooms: SharedRoom[] = [];
  const roomKeys = new Set<string>();
  for (const item of r.rooms) {
    const room = readRoom(item);
    if (room === undefined || roomKeys.has(room.key) || rooms.length >= TEAM_MAX_ROOMS) continue;
    roomKeys.add(room.key);
    rooms.push(room);
  }
  const agents: SharedAgent[] = [];
  const agentKeys = new Set<string>();
  for (const item of r.agents) {
    const agent = readAgent(item, roomKeys);
    if (agent === undefined || agentKeys.has(agent.key) || agents.length >= TEAM_MAX_AGENTS) continue;
    agentKeys.add(agent.key);
    agents.push(agent);
  }
  return { rooms, agents, ...(r.paused === true ? { paused: true as const } : {}) };
}

function readViewMember(raw: unknown): TeamViewMember | undefined {
  const r = record(raw);
  if (r === undefined || !isSafeKey(r.id)) return undefined;
  const name = cleanLine(r.name, TEAM_NAME_MAX);
  if (name === undefined) return undefined;
  const lastSeen = boundedNumber(r.lastSeenAgoMs, MAX_AGE_MS);
  const share = r.share === undefined ? undefined : parseTeamShare(r.share);
  return {
    id: r.id,
    name,
    device: cleanLine(r.device, TEAM_DEVICE_MAX) ?? '',
    host: r.host === true,
    online: r.online === true,
    ...(lastSeen !== undefined ? { lastSeenAgoMs: Math.round(lastSeen) } : {}),
    ...(share !== undefined ? { share } : {}),
  };
}

/** The merged team view from the host, rebuilt from the allowlist; undefined when it is not one. */
export function parseTeamView(raw: unknown): TeamViewMsg | undefined {
  const r = record(raw);
  if (r === undefined || !Array.isArray(r.members) || r.members.length > TEAM_MAX_MEMBERS + 1) return undefined;
  const teamName = cleanLine(r.teamName, TEAM_TEAMNAME_MAX);
  if (teamName === undefined) return undefined;
  const ids = new Set<string>();
  const members: TeamViewMember[] = [];
  for (const item of r.members) {
    const member = readViewMember(item);
    if (member === undefined || ids.has(member.id)) continue;
    ids.add(member.id);
    members.push(member);
  }
  return { teamName, members };
}

/** Sharing preferences from a file or a request: only booleans count, everything else is off. */
export function parseSharePrefs(raw: unknown): TeamSharePrefs {
  const r = record(raw) ?? {};
  const flag = (name: keyof TeamSharePrefs): boolean => r[name] === true;
  return {
    ...DEFAULT_TEAM_SHARE,
    paused: flag('paused'),
    projectNames: flag('projectNames'),
    activityText: flag('activityText'),
    titles: flag('titles'),
    branches: flag('branches'),
    usage: flag('usage'),
  };
}
