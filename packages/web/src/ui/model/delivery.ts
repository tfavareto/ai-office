// Summaries for messages the user sent: one line per message, or one grouped line for a team message.
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
      const how = first.via === 'stop' ? 'como nova instrução' : 'durante o trabalho';
      return { key: first.id, text: `${name} recebeu sua mensagem ${how}.`, level: 'success', complete, delivered, total };
    }
    if (first.status === 'expired') {
      return { key: first.id, text: `A mensagem para ${name} expirou sem ser entregue.`, level: 'warn', complete, delivered, total };
    }
    return { key: first.id, text: `Mensagem para ${name} na fila.`, level: 'info', complete, delivered, total };
  }

  const team = ctx.teamLabel ? `Equipe ${ctx.teamLabel}` : 'Equipe';
  const progress = `${delivered} de ${total} ${delivered === 1 ? 'entregue' : 'entregues'}`;
  const tail = complete && expired > 0 ? ` (${expired} ${expired === 1 ? 'expirou' : 'expiraram'})` : '';
  return {
    key: first.group ?? first.id,
    text: `${team}: ${progress}${tail}`,
    level: complete ? (expired > 0 ? 'warn' : 'success') : 'info',
    complete,
    delivered,
    total,
  };
}
