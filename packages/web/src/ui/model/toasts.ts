// Toast model: dedupe, auto-dismiss for non-alerts, alerts persist until their agent no longer needs the user.
import type { Agent, Msg, Notice, NoticeLevel } from '@ai-office/shared';

export interface Toast {
  id: string;
  key: string;
  level: NoticeLevel;
  text: string;
  /** Localizable form of `text`. */
  msg?: Msg;
  agentId?: string;
  projectId?: string;
  count: number;
  createdAt: number;
  /** Epoch ms when it disappears by itself; null for alerts (persistent). */
  expiresAt: number | null;
}

export const TOAST_TTL_MS: Record<NoticeLevel, number | null> = { info: 5000, success: 4500, warn: 8000, alert: null };
export const MAX_TOASTS = 4;

function keyOf(notice: Pick<Notice, 'level' | 'text' | 'agentId'>): string {
  return `${notice.level}|${notice.agentId ?? ''}|${notice.text}`;
}

export function pushToast(toasts: readonly Toast[], notice: Notice, now: number): Toast[] {
  const key = keyOf(notice);
  const ttl = TOAST_TTL_MS[notice.level];
  const expiresAt = ttl === null ? null : now + ttl;
  const existing = toasts.find((toast) => toast.key === key);
  if (existing) {
    return toasts.map((toast) => (toast === existing ? { ...toast, count: toast.count + 1, expiresAt } : toast));
  }
  const next: Toast = {
    id: notice.id,
    key,
    level: notice.level,
    text: notice.text,
    msg: notice.msg,
    agentId: notice.agentId,
    projectId: notice.projectId,
    count: 1,
    createdAt: now,
    expiresAt,
  };
  const all = [...toasts, next];
  if (all.length <= MAX_TOASTS) return all;
  // Drop the oldest expirable toast first; alerts are only dropped when nothing else is left.
  const dropIndex = all.findIndex((toast) => toast.expiresAt !== null);
  return all.filter((_, index) => index !== (dropIndex >= 0 ? dropIndex : 0));
}

export function expireToasts(toasts: readonly Toast[], now: number): Toast[] {
  const alive = toasts.filter((toast) => toast.expiresAt === null || toast.expiresAt > now);
  return alive.length === toasts.length ? (toasts as Toast[]) : alive;
}

export function dismissToast(toasts: readonly Toast[], id: string): Toast[] {
  return toasts.filter((toast) => toast.id !== id);
}

/** Grace period: a notice can reach the page slightly before the snapshot that shows the agent waiting. */
export const ALERT_GRACE_MS = 5000;

/** Alerts disappear once their agent stopped waiting (or left the office). */
export function resolveAlertToasts(toasts: readonly Toast[], agents: readonly Agent[], now: number): Toast[] {
  const waiting = new Set(agents.filter((agent) => agent.status === 'waiting').map((agent) => agent.id));
  const next = toasts.filter(
    (toast) =>
      toast.level !== 'alert' || !toast.agentId || now - toast.createdAt < ALERT_GRACE_MS || waiting.has(toast.agentId),
  );
  return next.length === toasts.length ? (toasts as Toast[]) : next;
}
