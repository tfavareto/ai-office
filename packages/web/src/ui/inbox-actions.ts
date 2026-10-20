// What the inbox does with an item: answer a permission request (one or in bulk), open the agent or its terminal,
// mark things as seen. Decisions go through the same client and endpoint as the drawer's permission card.
import type { Agent, PermissionDecision } from '@ai-office/shared';
import { t } from '../i18n';
import type { AppContext } from './context';
import { uiMsg } from './display';
import type { InboxItem } from './model/inbox';
import { seenableIds } from './model/inbox';
import type { BulkPlan } from './model/inbox-bulk';

export class InboxActions {
  constructor(private readonly ctx: AppContext) {}

  /** The agent that still waits on exactly this request (a stale item has nothing to answer). */
  private agentFor(item: InboxItem): Agent | undefined {
    const agent = this.ctx.agent(item.agentId);
    return agent?.permission !== undefined && agent.permission.id === item.permission?.id ? agent : undefined;
  }

  canAnswer(item: InboxItem): boolean {
    return this.ctx.isLocal && item.expired !== true && !this.ctx.inbox.get().busy.includes(item.id);
  }

  /** The suggestion that "approve and don't ask again" remembers: the first one, never for a risky request. */
  rememberable(item: InboxItem): boolean {
    return item.risk === undefined && (item.permission?.suggestions.length ?? 0) > 0;
  }

  private async decide(item: InboxItem, decision: PermissionDecision): Promise<boolean> {
    const agent = this.agentFor(item);
    if (!agent || !this.canAnswer(item)) return false;
    this.ctx.inbox.setBusy([item.id], true);
    const ok = await this.ctx.decidePermission(agent, decision);
    // On success the next snapshot removes the item; keep it locked meanwhile. On failure let the user retry.
    if (!ok) this.ctx.inbox.setBusy([item.id], false);
    return ok;
  }

  approve(item: InboxItem): Promise<boolean> {
    return this.decide(item, { behavior: 'allow' });
  }

  approveAndRemember(item: InboxItem): Promise<boolean> {
    return this.rememberable(item) ? this.decide(item, { behavior: 'allow', suggestion: 0 }) : Promise.resolve(false);
  }

  deny(item: InboxItem, reason?: string): Promise<boolean> {
    const message = reason?.trim();
    return this.decide(item, { behavior: 'deny', ...(message ? { message } : {}) });
  }

  async answerInTerminal(item: InboxItem): Promise<void> {
    const agent = this.agentFor(item);
    if (agent && (await this.decide(item, { behavior: 'terminal' }))) this.ctx.openTerminalForAgent(agent);
  }

  /** Runs a confirmed bulk plan, one request after the other, and reports how it went. */
  async runBulk(plan: BulkPlan, reason?: string): Promise<void> {
    let sent = 0;
    for (const item of plan.include) {
      const ok = plan.action === 'approve' ? await this.approve(item) : await this.deny(item, reason);
      if (ok) sent++;
    }
    this.ctx.inbox.set({ confirm: null });
    this.ctx.inbox.clearSelection();
    if (sent > 0) this.ctx.announce(t('inbox.result.sent', { n: sent }));
    const failed = plan.include.length - sent;
    if (failed > 0) this.ctx.notifyLocal('warn', uiMsg('inbox.result.failed', { n: failed }));
  }

  openAgent(item: InboxItem): void {
    this.ctx.selectAgent(item.agentId, { focus: true, tab: 'summary' });
    if (this.ctx.ui.get().narrow) this.ctx.closePopover();
  }

  openTerminal(item: InboxItem): void {
    const agent = this.ctx.agent(item.agentId);
    if (!agent) return;
    this.ctx.selectAgent(agent.id, { focus: true });
    this.ctx.openTerminalForAgent(agent);
    if (this.ctx.ui.get().narrow) this.ctx.closePopover();
  }

  markSeen(items: readonly InboxItem[]): void {
    const ids = seenableIds(items);
    if (ids.length === 0) return;
    this.ctx.inbox.markSeen(ids);
    this.ctx.announce(t('announce.inbox.seen'));
  }
}
