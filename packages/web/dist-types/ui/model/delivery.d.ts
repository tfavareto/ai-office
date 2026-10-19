import type { BossMessage, NoticeLevel } from '@ai-office/shared';
export interface DeliverySummary {
    /** Notification key: the group id for team messages, the message id otherwise. */
    key: string;
    text: string;
    level: NoticeLevel;
    /** Nothing is waiting in the queue anymore. */
    complete: boolean;
    delivered: number;
    total: number;
}
export interface DeliveryContext {
    nameOf(agentId: string): string;
    /** Room name shown for team messages. */
    teamLabel?: string;
}
export declare function summarizeDelivery(messages: readonly BossMessage[], ctx: DeliveryContext): DeliverySummary | null;
