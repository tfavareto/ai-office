// Messages from the user ("boss") to agents: queues, delivery through hooks, long-poll for the Stop hook.
import type { BossMessage, Locale } from '@ai-office/shared';
import { newId } from '../util/ids';

export const MESSAGE_TTL_MS = 2 * 60 * 60_000;
export const MESSAGES_KEPT = 50;
export const MAX_TEAM_SIZE = 24;
export const MAX_MESSAGE_LENGTH = 8000;
export const MAX_WAIT_MS = 25_000;

export interface InboxMessage {
  id: string;
  text: string;
  createdAt: number;
  /** Language of the sender: the hook phrases the delivery preamble in it. */
  locale?: Locale;
}

export interface MessageDeps {
  now: () => number;
  /** Called after a message was handed to a hook (adds the "Mensagem sua" activity). */
  onDelivered: (message: BossMessage) => void;
  onChange: () => void;
}

export class MessageRegistry {
  private readonly byAgent = new Map<string, BossMessage[]>();
  private readonly waiters = new Map<string, Set<() => void>>();

  constructor(private readonly deps: MessageDeps) {}

  /** Queues the text for each agent. Several agents share a group id. */
  send(agentIds: readonly string[], text: string, locale?: Locale): BossMessage[] {
    const targets = [...new Set(agentIds)].slice(0, MAX_TEAM_SIZE);
    const group = targets.length > 1 ? newId(6) : undefined;
    const now = this.deps.now();
    const created = targets.map((agentId): BossMessage => ({
      id: newId(8),
      agentId,
      text: text.slice(0, MAX_MESSAGE_LENGTH),
      createdAt: now,
      status: 'queued',
      ...(group !== undefined ? { group } : {}),
      ...(locale !== undefined ? { locale } : {}),
    }));
    for (const message of created) {
      this.byAgent.set(message.agentId, [...(this.byAgent.get(message.agentId) ?? []), message].slice(-MESSAGES_KEPT));
      this.wake(message.agentId);
    }
    this.deps.onChange();
    return created;
  }

  list(agentId: string): BossMessage[] {
    this.expire();
    return [...(this.byAgent.get(agentId) ?? [])];
  }

  hasQueued(agentId: string): boolean {
    return this.queued(agentId).length > 0;
  }

  /** Hands the queued messages to a hook and marks them delivered (`tool` = during work, `stop` = new instruction). */
  take(agentId: string, via: 'tool' | 'stop'): InboxMessage[] {
    const queued = this.queued(agentId);
    if (queued.length === 0) return [];
    const now = this.deps.now();
    const ids = new Set(queued.map((message) => message.id));
    const delivered: BossMessage[] = [];
    this.byAgent.set(
      agentId,
      (this.byAgent.get(agentId) ?? []).map((message) => {
        if (!ids.has(message.id)) return message;
        const updated: BossMessage = { ...message, status: 'delivered', deliveredAt: now, via };
        delivered.push(updated);
        return updated;
      }),
    );
    for (const message of delivered) this.deps.onDelivered(message);
    this.deps.onChange();
    return queued.map(({ id, text, createdAt, locale }) => ({ id, text, createdAt, ...(locale !== undefined ? { locale } : {}) }));
  }

  /** Long-poll: resolves with the queued messages as soon as one exists, or an empty list after the timeout. */
  async wait(agentId: string, timeoutMs: number, signal?: AbortSignal): Promise<InboxMessage[]> {
    if (this.hasQueued(agentId)) return this.take(agentId, 'stop');
    const limit = Math.min(Math.max(timeoutMs, 0), MAX_WAIT_MS);
    await new Promise<void>((resolve) => {
      const waiters = this.waiters.get(agentId) ?? new Set<() => void>();
      this.waiters.set(agentId, waiters);
      const done = (): void => {
        clearTimeout(timer);
        waiters.delete(done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, limit);
      waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
    return signal?.aborted === true ? [] : this.take(agentId, 'stop');
  }

  /** Marks queued messages older than the TTL as expired. */
  expire(): void {
    const now = this.deps.now();
    let changed = false;
    for (const [agentId, messages] of this.byAgent) {
      if (!messages.some((message) => message.status === 'queued' && now - message.createdAt > MESSAGE_TTL_MS)) continue;
      changed = true;
      this.byAgent.set(
        agentId,
        messages.map((message): BossMessage => (message.status === 'queued' && now - message.createdAt > MESSAGE_TTL_MS ? { ...message, status: 'expired' } : message)),
      );
    }
    if (changed) this.deps.onChange();
  }

  private queued(agentId: string): BossMessage[] {
    this.expire();
    return (this.byAgent.get(agentId) ?? []).filter((message) => message.status === 'queued');
  }

  private wake(agentId: string): void {
    for (const waiter of [...(this.waiters.get(agentId) ?? [])]) waiter();
  }
}
