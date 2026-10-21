// Builds Agent objects (the shared model) from session records, registry data and overlays.
import { type Agent, type AgentStatus, type PermissionRequest, fnv1a, msg, sourceText } from '@ai-office/shared';
import type { TranscriptState } from '../claude/transcript-state';
import { NEEDS_YOU_MSG, NEEDS_YOU_TEXT, deriveStatus } from './status';
import { type SessionRecord, type SubRecord, isSubDone } from './records';

export interface Overlay {
  permission?: PermissionRequest;
  attention?: string;
}

export function mainAgentId(record: SessionRecord): string {
  return record.key;
}

export function subAgentId(record: SessionRecord, agentId: string): string {
  return `${record.key}:${agentId}`;
}

function earliest(...values: (number | undefined)[]): number {
  const known = values.filter((value): value is number => value !== undefined && value > 0);
  return known.length === 0 ? 0 : Math.min(...known);
}

function commonFields(
  state: TranscriptState,
  now: number,
): Pick<Agent, 'activity' | 'recent' | 'tasks' | 'shells' | 'stats' | 'model' | 'gitBranch' | 'permissionMode'> {
  const activity = state.activity;
  return {
    ...(activity !== undefined ? { activity } : {}),
    recent: state.recent(),
    tasks: [...state.tasks],
    shells: state.shellsAt(now),
    stats: state.statsSnapshot(),
    ...(state.model !== undefined ? { model: state.model } : {}),
    ...(state.gitBranch !== undefined ? { gitBranch: state.gitBranch } : {}),
    ...(state.permissionMode !== undefined ? { permissionMode: state.permissionMode } : {}),
  };
}

function statusFields(
  state: TranscriptState,
  now: number,
  overlay: Overlay,
  registry: { status?: string; at?: number } | undefined,
): Pick<Agent, 'status' | 'waitingFor' | 'waitingForMsg' | 'permission'> {
  const blocking = state.oldestBlockingTool();
  const userTool = state.pendingUserTool();
  const derived = deriveStatus({
    now,
    turn: state.turn,
    lastEventAt: state.lastEventAt,
    ...(registry?.status !== undefined ? { registryStatus: registry.status } : {}),
    ...(registry?.at !== undefined ? { registryStatusAt: registry.at } : {}),
    permissionPending: overlay.permission !== undefined,
    ...(overlay.attention !== undefined ? { attentionMessage: overlay.attention } : {}),
    // Attention marks only ever carry the generic "needs you" text.
    ...(overlay.attention === NEEDS_YOU_TEXT ? { attentionMsg: NEEDS_YOU_MSG } : {}),
    ...(userTool !== undefined
      ? { pendingUserTool: userTool.waitingFor, pendingUserToolMsg: userTool.waitingForMsg }
      : {}),
    ...(blocking !== undefined ? { blockingTool: { name: blocking.name, at: blocking.at } } : {}),
  });
  return {
    status: derived.status,
    ...(derived.waitingFor !== undefined ? { waitingFor: derived.waitingFor } : {}),
    ...(derived.waitingForMsg !== undefined ? { waitingForMsg: derived.waitingForMsg } : {}),
    ...(overlay.permission !== undefined ? { permission: overlay.permission } : {}),
  };
}

export function buildMainAgent(
  record: SessionRecord,
  projectId: string,
  person: { name: string; look: 'f' | 'm' },
  overlay: Overlay,
  now: number,
): Agent {
  const state = record.main;
  const registry = record.registry;
  const closed = record.closedAt !== undefined;
  const base = closed
    ? { status: 'offline' as AgentStatus }
    : statusFields(
        state,
        now,
        overlay,
        registry === undefined
          ? undefined
          : {
              ...(registry.status !== undefined ? { status: registry.status } : {}),
              ...(registry.statusUpdatedAt !== undefined ? { at: registry.statusUpdatedAt } : {}),
            },
      );
  const title = registry?.name ?? state.title();
  const id = mainAgentId(record);
  const startedAt =
    registry?.startedAt && registry.startedAt > 0 ? registry.startedAt : earliest(state.firstEventAt, record.openedAt);
  return {
    id,
    kind: 'main',
    sessionId: record.sessionId,
    accountId: record.account.id,
    projectId,
    name: person.name,
    role: sourceText(msg('agent.role.main')),
    roleMsg: msg('agent.role.main'),
    ...(title !== undefined ? { title } : {}),
    look: person.look,
    seed: fnv1a(id),
    statusSince: Math.min(now, registry?.statusUpdatedAt ?? (state.lastEventAt || record.openedAt)),
    ...commonFields(state, now),
    ...base,
    startedAt,
    lastEventAt: Math.max(state.lastEventAt, registry?.updatedAt ?? 0) || record.openedAt,
  };
}

function subStatus(
  sub: SubRecord,
  done: boolean,
  overlay: Overlay,
  now: number,
): Pick<Agent, 'status' | 'waitingFor' | 'waitingForMsg' | 'permission'> {
  if (done) return { status: 'done' };
  const needsUser =
    overlay.permission !== undefined || overlay.attention !== undefined || sub.state.pendingUserTool() !== undefined;
  return needsUser ? statusFields(sub.state, now, overlay, undefined) : { status: 'working' };
}

export function buildSubAgent(
  record: SessionRecord,
  sub: SubRecord,
  projectId: string,
  parentId: string,
  person: { name: string; look: 'f' | 'm' },
  overlay: Overlay,
  now: number,
): Agent {
  const state = sub.state;
  const spawn = sub.meta?.toolUseId === undefined ? undefined : record.main.spawn(sub.meta.toolUseId);
  const done = isSubDone(record, sub, now);
  const id = subAgentId(record, sub.agentId);
  const title = sub.meta?.description ?? spawn?.description;
  const derived = subStatus(sub, done, overlay, now);
  const role = sub.meta?.agentType ?? spawn?.subagentType;
  return {
    id,
    kind: 'sub',
    sessionId: record.sessionId,
    accountId: record.account.id,
    projectId,
    parentId,
    name: person.name,
    role: role ?? sourceText(msg('agent.role.sub')),
    ...(role === undefined ? { roleMsg: msg('agent.role.sub') } : {}),
    ...(title !== undefined ? { title } : {}),
    look: person.look,
    seed: fnv1a(id),
    statusSince: Math.min(now, state.lastEventAt || record.openedAt),
    ...commonFields(state, now),
    ...derived,
    startedAt: earliest(state.firstEventAt, spawn?.at, record.openedAt),
    lastEventAt: state.lastEventAt || record.openedAt,
  };
}
