// Summaries for messages the user sent: one line per message, or one grouped line for a team message.
import type { BossMessage, NoticeLevel } from '@ai-office/shared';
import { t } from '../../i18n';

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

export function summarizeDelivery(messages: readonly BossMessage[], ctx: DeliveryContext): DeliverySummary | null {
  if (messages.length === 0) return null;
  const first = messages[0];
  const delivered = messages.filter((message) => message.status === 'delivered').length;
  const expired = messages.filter((message) => message.status === 'expired').length;
  const total = messages.length;
  const complete = delivered + expired === total;
  const isTeam = first.group !== undefined || total > 1;

  if (!isTeam) {
    const name = ctx.nameOf(first.agentId);
    if (first.status === 'delivered') {
      const text = t(first.via === 'stop' ? 'delivery.single.deliveredStop' : 'delivery.single.deliveredTool', { name });
      return { key: first.id, text, level: 'success', complete, delivered, total };
    }
    if (first.status === 'expired') {
      return { key: first.id, text: t('delivery.single.expired', { name }), level: 'warn', complete, delivered, total };
    }
    return { key: first.id, text: t('delivery.single.queued', { name }), level: 'info', complete, delivered, total };
  }

  const team = ctx.teamLabel ? t('delivery.team.named', { room: ctx.teamLabel }) : t('delivery.team.unnamed');
  const progress = t('message.group.progress', { delivered, total });
  const text = complete && expired > 0 ? t('delivery.team.withExpired', { team, progress, expired }) : t('delivery.team.line', { team, progress });
  return {
    key: first.group ?? first.id,
    text,
    level: complete ? (expired > 0 ? 'warn' : 'success') : 'info',
    complete,
    delivered,
    total,
  };
}
