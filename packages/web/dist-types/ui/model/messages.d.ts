import type { BossMessage } from '@ai-office/shared';
export declare const QUICK_MESSAGES: readonly string[];
export declare const MAX_MESSAGE_LENGTH = 4000;
export declare function messageStatusLabel(message: Pick<BossMessage, 'status' | 'via'>): string;
export interface MessageGroupView {
    /** Group id, or the id of a single message. */
    key: string;
    text: string;
    createdAt: number;
    messages: BossMessage[];
    delivered: number;
    expired: number;
    queued: number;
    total: number;
    isTeam: boolean;
}
/** "2 de 3 entregues" / "Entregue" / "Na fila" for a group of one or more messages. */
export declare function groupStatusLabel(group: Pick<MessageGroupView, 'delivered' | 'expired' | 'queued' | 'total' | 'messages' | 'isTeam'>): string;
/** Groups messages sent together to a team; the rest stay individual. Newest group first. */
export declare function groupMessages(messages: readonly BossMessage[]): MessageGroupView[];
/** Merges fresh server statuses into the locally known messages (by id), keeping order by creation. */
export declare function mergeMessages(known: readonly BossMessage[], fresh: readonly BossMessage[]): BossMessage[];
export declare function hasPending(messages: readonly BossMessage[]): boolean;
export declare function validateMessageText(raw: string): {
    ok: true;
    text: string;
} | {
    ok: false;
    error: string;
};
