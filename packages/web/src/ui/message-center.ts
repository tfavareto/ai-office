// Keeps the status of messages the user sent: polls while someone is watching or a message is still queued, and
// reports delivery changes so the notification center can show "2 de 3 entregues".
import type { BossMessage } from '@ai-office/shared';
import type { Backend } from '../net/backend';
import { summarizeDelivery, type DeliverySummary } from './model/delivery';
import { mergeMessages } from './model/messages';
import { Observable } from './observable';

export const MESSAGE_POLL_MS = 3000;
/** Stop following a message that is still queued after this long (the server expires it by then). */
const TRACK_LIMIT_MS = 15 * 60_000;

export type MessagesByAgent = ReadonlyMap<string, readonly BossMessage[]>;

interface Tracked {
  key: string;
  messageIds: Set<string>;
  teamLabel?: string;
  lastText: string;
  since: number;
}

export interface MessageCenterOptions {
  backend: Backend;
  nameOf(agentId: string): string;
  onDelivery(summary: DeliverySummary, agentId: string, final: boolean): void;
  now(): number;
}

export class MessageCenter extends Observable<MessagesByAgent> {
  private readonly watchedAgents = new Map<string, string[]>();
  private readonly tracked = new Map<string, Tracked>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly opts: MessageCenterOptions) {
    super(new Map());
  }

  messagesOf(agentId: string): readonly BossMessage[] {
    return this.value.get(agentId) ?? [];
  }

  /** Registers messages just sent (they are followed until delivered or expired). */
  track(messages: readonly BossMessage[], teamLabel?: string): void {
    if (messages.length === 0) return;
    this.ingest(messages);
    const key = messages[0].group ?? messages[0].id;
    this.tracked.set(key, {
      key,
      messageIds: new Set(messages.map((message) => message.id)),
      teamLabel,
      lastText: this.summaryOf(key)?.text ?? '',
      since: this.opts.now(),
    });
    this.ensurePolling();
  }

  /** The agents whose messages a view is showing; polling runs while at least one view watches. */
  watch(viewId: string, agentIds: readonly string[]): void {
    if (agentIds.length === 0) {
      this.unwatch(viewId);
      return;
    }
    this.watchedAgents.set(viewId, [...agentIds]);
    void this.refresh(agentIds);
    this.ensurePolling();
  }

  unwatch(viewId: string): void {
    this.watchedAgents.delete(viewId);
    this.stopIfIdle();
  }

  async refresh(agentIds: readonly string[]): Promise<void> {
    await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          this.ingest(await this.opts.backend.messages(agentId));
        } catch {
          // Transient failure: the next poll tries again.
        }
      }),
    );
    this.afterRefresh();
  }

  private ingest(messages: readonly BossMessage[]): void {
    if (messages.length === 0) return;
    const next = new Map(this.value);
    const byAgent = new Map<string, BossMessage[]>();
    for (const message of messages) {
      const list = byAgent.get(message.agentId);
      if (list) list.push(message);
      else byAgent.set(message.agentId, [message]);
    }
    for (const [agentId, list] of byAgent) next.set(agentId, mergeMessages(next.get(agentId) ?? [], list));
    this.replace(next);
  }

  private messagesFor(key: string): BossMessage[] {
    const tracked = this.tracked.get(key);
    if (!tracked) return [];
    const all: BossMessage[] = [];
    for (const list of this.value.values())
      for (const message of list) if (tracked.messageIds.has(message.id)) all.push(message);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  private summaryOf(key: string): DeliverySummary | null {
    return summarizeDelivery(this.messagesFor(key), {
      nameOf: this.opts.nameOf,
      teamLabel: this.tracked.get(key)?.teamLabel,
    });
  }

  private afterRefresh(): void {
    const now = this.opts.now();
    for (const [key, tracked] of [...this.tracked]) {
      const messages = this.messagesFor(key);
      const summary = this.summaryOf(key);
      if (!summary) continue;
      const stale = now - tracked.since > TRACK_LIMIT_MS;
      if (summary.text !== tracked.lastText) {
        tracked.lastText = summary.text;
        this.opts.onDelivery(summary, messages[0].agentId, summary.complete);
      }
      if (summary.complete || stale) this.tracked.delete(key);
    }
    this.stopIfIdle();
  }

  private pollTargets(): string[] {
    const ids = new Set<string>();
    for (const list of this.watchedAgents.values()) for (const id of list) ids.add(id);
    for (const key of this.tracked.keys())
      for (const message of this.messagesFor(key)) if (message.status === 'queued') ids.add(message.agentId);
    return [...ids];
  }

  private ensurePolling(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.busy || (typeof document !== 'undefined' && document.hidden)) return;
      const targets = this.pollTargets();
      if (targets.length === 0) return;
      this.busy = true;
      void this.refresh(targets).finally(() => {
        this.busy = false;
      });
    }, MESSAGE_POLL_MS);
  }

  private stopIfIdle(): void {
    if (this.timer === null || this.watchedAgents.size > 0 || this.tracked.size > 0) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.watchedAgents.clear();
    this.tracked.clear();
  }
}
