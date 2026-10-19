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
export declare const MAX_NOTIFICATIONS = 100;
/** Identical notices closer than this collapse into one entry. */
export declare const DEDUPE_WINDOW_MS = 120000;
export declare const EMPTY_NOTIFICATIONS: NotificationState;
export declare function classifyNotice(notice: Pick<Notice, 'level' | 'text'>): NotificationKind;
export declare function noticeKey(notice: Pick<Notice, 'level' | 'text' | 'agentId'>): string;
export interface AddResult {
    state: NotificationState;
    item: NotificationItem;
    /** False when the notice only bumped an existing entry (a repeat). */
    isNew: boolean;
}
export declare function addNotice(state: NotificationState, notice: Notice): AddResult;
/** Adds or updates a keyed entry whose text changes over time (e.g. "2 de 3 entregues"). */
export declare function upsertGrouped(state: NotificationState, entry: {
    key: string;
    at: number;
    level: NoticeLevel;
    kind: NotificationKind;
    text: string;
    agentId?: string;
    projectId?: string;
}): AddResult;
export declare function markAllRead(state: NotificationState): NotificationState;
export declare function clearAll(state: NotificationState): NotificationState;
export declare function setDnd(state: NotificationState, dnd: boolean): NotificationState;
export declare function unreadCount(state: NotificationState): number;
export declare function filterItems(items: readonly NotificationItem[], filter: NotificationFilter): NotificationItem[];
/** With "Não perturbe" only alerts interrupt (toast, sound, browser notification). */
export declare function shouldInterrupt(state: Pick<NotificationState, 'dnd'>, level: NoticeLevel): boolean;
