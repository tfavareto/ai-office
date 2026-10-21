// Messages to agents: status labels, grouping of team messages, delivery summaries.
import type { BossMessage } from '@ai-office/shared';
import { t, type UiKey } from '../../i18n';

const QUICK_MESSAGE_KEYS = [
  'message.quick.progress',
  'message.quick.plan',
  'message.quick.tests',
  'message.quick.finish',
] as const satisfies readonly UiKey[];

/** Ready-made orders offered as chips above the composer, in the current language. */
export function quickMessages(): string[] {
  return QUICK_MESSAGE_KEYS.map((key) => t(key));
}

export const MAX_MESSAGE_LENGTH = 4000;

export function messageStatusLabel(message: Pick<BossMessage, 'status' | 'via'>): string {
  if (message.status === 'queued') return t('message.status.queued');
  if (message.status === 'expired') return t('message.status.expired');
  switch (message.via) {
    case 'tool':
      return t('message.status.deliveredTool');
    case 'stop':
      return t('message.status.deliveredStop');
    default:
      return t('message.status.delivered');
  }
}

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
export function groupStatusLabel(
  group: Pick<MessageGroupView, 'delivered' | 'expired' | 'queued' | 'total' | 'messages' | 'isTeam'>,
): string {
  if (!group.isTeam) return messageStatusLabel(group.messages[0]);
  const base = t('message.group.progress', { delivered: group.delivered, total: group.total });
  if (group.queued > 0) return t('message.group.withQueued', { base, queued: group.queued });
  if (group.expired > 0) return t('message.group.withExpired', { base, expired: group.expired });
  return base;
}

/** Groups messages sent together to a team; the rest stay individual. Newest group first. */
export function groupMessages(messages: readonly BossMessage[]): MessageGroupView[] {
  const groups = new Map<string, BossMessage[]>();
  for (const message of messages) {
    const key = message.group ?? message.id;
    const list = groups.get(key);
    if (list) list.push(message);
    else groups.set(key, [message]);
  }
  const views: MessageGroupView[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt);
    views.push({
      key,
      text: sorted[0].text,
      createdAt: sorted[0].createdAt,
      messages: sorted,
      delivered: sorted.filter((message) => message.status === 'delivered').length,
      expired: sorted.filter((message) => message.status === 'expired').length,
      queued: sorted.filter((message) => message.status === 'queued').length,
      total: sorted.length,
      isTeam: sorted.length > 1 || sorted.some((message) => message.group !== undefined),
    });
  }
  return views.sort((a, b) => b.createdAt - a.createdAt);
}

/** Merges fresh server statuses into the locally known messages (by id), keeping order by creation. */
export function mergeMessages(known: readonly BossMessage[], fresh: readonly BossMessage[]): BossMessage[] {
  const byId = new Map(known.map((message) => [message.id, message]));
  for (const message of fresh) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function hasPending(messages: readonly BossMessage[]): boolean {
  return messages.some((message) => message.status === 'queued');
}

export function validateMessageText(raw: string): { ok: true; text: string } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: t('message.error.empty') };
  if (text.length > MAX_MESSAGE_LENGTH)
    return { ok: false, error: t('message.error.tooLong', { max: String(MAX_MESSAGE_LENGTH) }) };
  return { ok: true, text };
}
