// Notification center model: immutable list with dedupe, filters, unread counting and "do not disturb".
import type { Notice, NoticeLevel } from '@ai-office/shared';

export type NotificationKind = 'alert' | 'message' | 'info';
export type NotificationFilter = 'all' | 'alerts' | 'messages';

export interface NotificationItem {
  id: string;
  /** Items with the same key collapse into one (repeats, team deliveries). */
  key: string;
  at: number;
  level: NoticeLevel;
  kind: NotificationKind;
  text: string;
  agentId?: string;
  projectId?: string;
  count: number;
  read: boolean;
}

export interface NotificationState {
  /** Newest first. */
  items: NotificationItem[];
  dnd: boolean;
}

export const MAX_NOTIFICATIONS = 100;
/** Identical notices closer than this collapse into one entry. */
export const DEDUPE_WINDOW_MS = 120_000;

export const EMPTY_NOTIFICATIONS: NotificationState = { items: [], dnd: false };

const MESSAGE_PATTERN = /\b(mensagem|mensagens|ordem|ordens|entreg|instru[cç][aã]o)/i;

export function classifyNotice(notice: Pick<Notice, 'level' | 'text'>): NotificationKind {
  if (notice.level === 'alert') return 'alert';
  return MESSAGE_PATTERN.test(notice.text) ? 'message' : 'info';
}

export function noticeKey(notice: Pick<Notice, 'level' | 'text' | 'agentId'>): string {
  return `${notice.level}|${notice.agentId ?? ''}|${notice.text}`;
}

export interface AddResult {
  state: NotificationState;
  item: NotificationItem;
  /** False when the notice only bumped an existing entry (a repeat). */
  isNew: boolean;
}

interface Draft {
  key: string;
  at: number;
  level: NoticeLevel;
  kind: NotificationKind;
  text: string;
  agentId?: string;
  projectId?: string;
  id: string;
}

function insert(state: NotificationState, draft: Draft, replaceText: boolean): AddResult {
  const existingIndex = state.items.findIndex((item) => item.key === draft.key && draft.at - item.at <= DEDUPE_WINDOW_MS);
  if (existingIndex >= 0) {
    const existing = state.items[existingIndex];
    const updated: NotificationItem = {
      ...existing,
      at: draft.at,
      count: replaceText ? existing.count : existing.count + 1,
      text: replaceText ? draft.text : existing.text,
      level: draft.level,
      read: false,
    };
    const items = [updated, ...state.items.filter((_, index) => index !== existingIndex)];
    return { state: { ...state, items }, item: updated, isNew: false };
  }
  const item: NotificationItem = {
    id: draft.id,
    key: draft.key,
    at: draft.at,
    level: draft.level,
    kind: draft.kind,
    text: draft.text,
    agentId: draft.agentId,
    projectId: draft.projectId,
    count: 1,
    read: false,
  };
  return { state: { ...state, items: [item, ...state.items].slice(0, MAX_NOTIFICATIONS) }, item, isNew: true };
}

export function addNotice(state: NotificationState, notice: Notice): AddResult {
  return insert(
    state,
    {
      id: notice.id,
      key: noticeKey(notice),
      at: notice.at,
      level: notice.level,
      kind: classifyNotice(notice),
      text: notice.text,
      agentId: notice.agentId,
      projectId: notice.projectId,
    },
    false,
  );
}

/** Adds or updates a keyed entry whose text changes over time (e.g. "2 de 3 entregues"). */
export function upsertGrouped(
  state: NotificationState,
  entry: { key: string; at: number; level: NoticeLevel; kind: NotificationKind; text: string; agentId?: string; projectId?: string },
): AddResult {
  const existing = state.items.find((item) => item.key === entry.key);
  if (existing) {
    const updated: NotificationItem = { ...existing, at: entry.at, text: entry.text, level: entry.level, read: existing.text === entry.text ? existing.read : false };
    return { state: { ...state, items: [updated, ...state.items.filter((item) => item !== existing)] }, item: updated, isNew: false };
  }
  return insert(state, { ...entry, id: `group:${entry.key}` }, true);
}

export function markAllRead(state: NotificationState): NotificationState {
  if (state.items.every((item) => item.read)) return state;
  return { ...state, items: state.items.map((item) => (item.read ? item : { ...item, read: true })) };
}

export function clearAll(state: NotificationState): NotificationState {
  return state.items.length === 0 ? state : { ...state, items: [] };
}

export function setDnd(state: NotificationState, dnd: boolean): NotificationState {
  return state.dnd === dnd ? state : { ...state, dnd };
}

export function unreadCount(state: NotificationState): number {
  return state.items.reduce((sum, item) => sum + (item.read ? 0 : 1), 0);
}

export function filterItems(items: readonly NotificationItem[], filter: NotificationFilter): NotificationItem[] {
  switch (filter) {
    case 'alerts':
      return items.filter((item) => item.kind === 'alert');
    case 'messages':
      return items.filter((item) => item.kind === 'message');
    default:
      return [...items];
  }
}

/** With "Não perturbe" only alerts interrupt (toast, sound, browser notification). */
export function shouldInterrupt(state: Pick<NotificationState, 'dnd'>, level: NoticeLevel): boolean {
  return !state.dnd || level === 'alert';
}
