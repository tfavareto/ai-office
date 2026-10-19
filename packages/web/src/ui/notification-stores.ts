// Observable stores wrapping the pure notification and toast models.
import type { Agent, Notice } from '@ai-office/shared';
import {
  EMPTY_NOTIFICATIONS,
  addNotice,
  clearAll,
  markAllRead,
  setDnd,
  upsertGrouped,
  type AddResult,
  type NotificationState,
} from './model/notifications';
import { dismissToast, expireToasts, pushToast, resolveAlertToasts, type Toast } from './model/toasts';
import { Observable } from './observable';

export class NotificationsStore extends Observable<NotificationState> {
  constructor() {
    super(EMPTY_NOTIFICATIONS);
  }

  addNotice(notice: Notice): AddResult {
    const result = addNotice(this.value, notice);
    this.replace(result.state);
    return result;
  }

  upsertGrouped(entry: Parameters<typeof upsertGrouped>[1]): AddResult {
    const result = upsertGrouped(this.value, entry);
    this.replace(result.state);
    return result;
  }

  markAllRead(): void {
    this.replace(markAllRead(this.value));
  }

  clear(): void {
    this.replace(clearAll(this.value));
  }

  setDnd(dnd: boolean): void {
    this.replace(setDnd(this.value, dnd));
  }
}

export class ToastStore extends Observable<Toast[]> {
  constructor() {
    super([]);
  }

  push(notice: Notice, now: number): void {
    this.replace(pushToast(this.value, notice, now));
  }

  dismiss(id: string): void {
    this.replace(dismissToast(this.value, id));
  }

  tick(now: number): void {
    this.replace(expireToasts(this.value, now));
  }

  resolve(agents: readonly Agent[], now: number): void {
    this.replace(resolveAlertToasts(this.value, agents, now));
  }
}
