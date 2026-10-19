import type { Agent, Notice } from '@ai-office/shared';
import { upsertGrouped, type AddResult, type NotificationState } from './model/notifications';
import { type Toast } from './model/toasts';
import { Observable } from './observable';
export declare class NotificationsStore extends Observable<NotificationState> {
    constructor();
    addNotice(notice: Notice): AddResult;
    upsertGrouped(entry: Parameters<typeof upsertGrouped>[1]): AddResult;
    markAllRead(): void;
    clear(): void;
    setDnd(dnd: boolean): void;
}
export declare class ToastStore extends Observable<Toast[]> {
    constructor();
    push(notice: Notice, now: number): void;
    dismiss(id: string): void;
    tick(now: number): void;
    resolve(agents: readonly Agent[], now: number): void;
}
