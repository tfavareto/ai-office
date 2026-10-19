import type { Agent, Notice, NoticeLevel } from '@ai-office/shared';
export interface Toast {
    id: string;
    key: string;
    level: NoticeLevel;
    text: string;
    agentId?: string;
    projectId?: string;
    count: number;
    createdAt: number;
    /** Epoch ms when it disappears by itself; null for alerts (persistent). */
    expiresAt: number | null;
}
export declare const TOAST_TTL_MS: Record<NoticeLevel, number | null>;
export declare const MAX_TOASTS = 4;
export declare function pushToast(toasts: readonly Toast[], notice: Notice, now: number): Toast[];
export declare function expireToasts(toasts: readonly Toast[], now: number): Toast[];
export declare function dismissToast(toasts: readonly Toast[], id: string): Toast[];
/** Grace period: a notice can reach the page slightly before the snapshot that shows the agent waiting. */
export declare const ALERT_GRACE_MS = 5000;
/** Alerts disappear once their agent stopped waiting (or left the office). */
export declare function resolveAlertToasts(toasts: readonly Toast[], agents: readonly Agent[], now: number): Toast[];
