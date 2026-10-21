// The "needs you" inbox: one prioritized list of everything that waits on the user, derived from the snapshot and the
// notifications. Pure: no DOM, no storage.
import {
  detectRisk,
  type Activity,
  type Agent,
  type Msg,
  type OfficeSnapshot,
  type PermissionRequest,
  type RiskReason,
} from '@ai-office/shared';
import { type InboxState, isSeen } from './inbox-state';
import type { NotificationItem } from './notifications';
import { similarityKey } from './permission-pattern';
import { displayStatus, isLive } from './status';

export type InboxKind = 'permission' | 'attention' | 'error' | 'finished';

/** Lower comes first. */
export const KIND_PRIORITY: Readonly<Record<InboxKind, number>> = {
  permission: 0,
  attention: 1,
  error: 2,
  finished: 3,
};

/** "Finished" items older than this are noise. */
export const FINISHED_MAX_AGE_MS = 24 * 3_600_000;
/** A permission this close to expiring is shown as urgent. */
export const EXPIRING_SOON_MS = 10_000;
/** A notice may be recorded slightly before the agent's status change. */
const NOTICE_SLACK_MS = 5_000;

export interface InboxItem {
  /** Stable while the situation lasts; changes when it happens again (so "seen" does not hide a new occurrence). */
  id: string;
  kind: InboxKind;
  agentId: string;
  projectId: string;
  /** When it started waiting (permission created, wait began, failure happened, agent went idle). */
  at: number;
  seen: boolean;
  /** Permission requests only. */
  permission?: PermissionRequest;
  risk?: RiskReason;
  similarKey?: string;
  expired?: boolean;
  /** What an attention item waits for (agent's own words, or the alert that told us). */
  waitingText?: string;
  waitingMsg?: Msg;
  /** The failed activity of an error item. */
  failure?: Activity;
}

export interface InboxCounts {
  permission: number;
  attention: number;
  error: number;
  finished: number;
  /** What the top bar shows: open permissions, unseen attention and errors. */
  urgent: number;
}

export interface InboxView {
  /** Visible items in display order. */
  items: InboxItem[];
  counts: InboxCounts;
}

export const EMPTY_INBOX_VIEW: InboxView = {
  items: [],
  counts: { permission: 0, attention: 0, error: 0, finished: 0, urgent: 0 },
};

export interface InboxInput {
  snapshot: OfficeSnapshot | null;
  notifications: readonly NotificationItem[];
  state: InboxState;
  now: number;
}

export function isExpired(permission: Pick<PermissionRequest, 'expiresAt'>, now: number): boolean {
  return permission.expiresAt <= now;
}

export function isExpiringSoon(permission: Pick<PermissionRequest, 'expiresAt'>, now: number): boolean {
  return !isExpired(permission, now) && permission.expiresAt - now <= EXPIRING_SOON_MS;
}

function alertNoticeFor(agent: Agent, notifications: readonly NotificationItem[]): NotificationItem | undefined {
  return notifications.find(
    (item) => item.kind === 'alert' && item.agentId === agent.id && item.at >= agent.statusSince - NOTICE_SLACK_MS,
  );
}

function base(agent: Agent, id: string, kind: InboxKind, at: number, state: InboxState): InboxItem {
  return { id, kind, agentId: agent.id, projectId: agent.projectId, at, seen: isSeen(state, id) };
}

function permissionItem(agent: Agent, permission: PermissionRequest, state: InboxState, now: number): InboxItem {
  const risk = detectRisk(permission);
  return {
    ...base(agent, `permission:${permission.id}`, 'permission', permission.createdAt, state),
    permission,
    ...(risk !== null ? { risk } : {}),
    similarKey: similarityKey(permission),
    expired: isExpired(permission, now),
  };
}

function attentionItem(agent: Agent, input: InboxInput): InboxItem {
  const notice = agent.waitingFor === undefined ? alertNoticeFor(agent, input.notifications) : undefined;
  const item = base(agent, `attention:${agent.id}:${agent.statusSince}`, 'attention', agent.statusSince, input.state);
  if (agent.waitingFor !== undefined)
    return {
      ...item,
      waitingText: agent.waitingFor,
      ...(agent.waitingForMsg !== undefined ? { waitingMsg: agent.waitingForMsg } : {}),
    };
  return notice
    ? { ...item, waitingText: notice.text, ...(notice.msg !== undefined ? { waitingMsg: notice.msg } : {}) }
    : item;
}

function errorItem(agent: Agent, failure: Activity, state: InboxState): InboxItem {
  return { ...base(agent, `error:${agent.id}:${failure.id}`, 'error', failure.at, state), failure };
}

function hasWorked(agent: Agent): boolean {
  return agent.stats.toolCalls > 0 || agent.recent.length > 0;
}

function isFinished(agent: Agent, state: InboxState, now: number): boolean {
  return (
    agent.kind === 'main' &&
    displayStatus(agent) === 'idle' &&
    hasWorked(agent) &&
    state.baseline !== null &&
    agent.statusSince > state.baseline &&
    now - agent.statusSince <= FINISHED_MAX_AGE_MS
  );
}

function candidatesOf(agent: Agent, input: InboxInput): InboxItem[] {
  if (!isLive(agent)) return [];
  if (agent.status === 'waiting') {
    return [
      agent.permission ? permissionItem(agent, agent.permission, input.state, input.now) : attentionItem(agent, input),
    ];
  }
  if (agent.kind !== 'main') return [];
  if (displayStatus(agent) === 'error' && agent.activity) return [errorItem(agent, agent.activity, input.state)];
  if (isFinished(agent, input.state, input.now))
    return [base(agent, `finished:${agent.id}:${agent.statusSince}`, 'finished', agent.statusSince, input.state)];
  return [];
}

function permissionRank(item: InboxItem): number {
  return item.expired ? 1 : 0;
}

/** Priority, then age: what waits longest (or expires first) comes first; finished work shows the newest first. */
export function compareItems(a: InboxItem, b: InboxItem): number {
  const byKind = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind];
  if (byKind !== 0) return byKind;
  if (a.kind === 'permission' && b.kind === 'permission') {
    const byExpiry =
      permissionRank(a) - permissionRank(b) || (a.permission?.expiresAt ?? 0) - (b.permission?.expiresAt ?? 0);
    if (byExpiry !== 0) return byExpiry;
  }
  const byAge = a.kind === 'finished' ? b.at - a.at : a.at - b.at;
  return byAge || a.id.localeCompare(b.id);
}

function countOf(items: readonly InboxItem[], kind: InboxKind): number {
  return items.filter((item) => item.kind === kind).length;
}

export function buildInbox(input: InboxInput): InboxView {
  if (!input.snapshot) return EMPTY_INBOX_VIEW;
  const items = input.snapshot.agents
    .flatMap((agent) => candidatesOf(agent, input))
    .filter((item) => item.kind === 'permission' || !item.seen)
    .sort(compareItems);
  const permission = items.filter((item) => item.kind === 'permission' && item.expired !== true).length;
  const attention = countOf(items, 'attention');
  const error = countOf(items, 'error');
  return {
    items,
    counts: {
      permission,
      attention,
      error,
      finished: countOf(items, 'finished'),
      urgent: permission + attention + error,
    },
  };
}

/** Ids of the items that can be marked as seen (everything but permission requests). */
export function seenableIds(items: readonly InboxItem[]): string[] {
  return items.filter((item) => item.kind !== 'permission').map((item) => item.id);
}

/** Finished items of one agent (opening the agent counts as looking at them). */
export function finishedIdsOf(items: readonly InboxItem[], agentId: string): string[] {
  return items.filter((item) => item.kind === 'finished' && item.agentId === agentId).map((item) => item.id);
}
