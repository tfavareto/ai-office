// Usage cards in the top bar: tokens and estimated cost per account (5 h window, week, today).
import type { AccountUsage } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext, Component } from '../context';
import { accountLabel } from '../display';
import { h } from '../dom';
import { formatCost, formatResetIn, formatTokens } from '../format';
import { accountChip } from '../widgets';

function usageSignature(usage: readonly AccountUsage[], accountIds: string): string {
  return `${accountIds}|${usage.map((u) => `${u.accountId}:${u.window5h.tokens}:${Math.round(u.window5h.costUSD * 100)}:${u.week.tokens}:${Math.round(u.week.costUSD * 100)}:${u.today.tokens}`).join(',')}`;
}

export class UsageCards implements Component {
  readonly el = h('div', { class: 'ao-usage', role: 'list', 'aria-label': t('usage.label') });
  private signature = '';

  constructor(private readonly ctx: AppContext) {}

  render(): void {
    const snapshot = this.ctx.snapshot;
    const accounts = snapshot?.accounts ?? [];
    const usage = snapshot?.usage ?? [];
    const signature = usageSignature(usage, accounts.map((a) => `${a.id}${a.label}${a.color}`).join(';'));
    if (signature === this.signature) return;
    this.signature = signature;
    this.el.replaceChildren(...accounts.flatMap((account) => {
      const entry = usage.find((u) => u.accountId === account.id);
      return entry ? [this.card(account.id, entry)] : [];
    }));
  }

  private card(accountId: string, usage: AccountUsage): HTMLElement {
    const account = this.ctx.account(accountId);
    const card = h(
      'div',
      { class: 'ao-usage-card', role: 'listitem', tabindex: '0', title: this.tooltip(account ? accountLabel(account) : t('usage.account'), usage) },
      accountChip(account),
      h(
        'div',
        { class: 'ao-usage-lines' },
        this.line(t('usage.window5h'), usage.window5h.tokens, usage.window5h.costUSD),
        this.line(t('usage.week'), usage.week.tokens, usage.week.costUSD),
      ),
    );
    card.addEventListener('pointerenter', () => {
      card.title = this.tooltip(account ? accountLabel(account) : t('usage.account'), usage);
    });
    return card;
  }

  private line(label: string, tokens: number, cost: number): HTMLElement {
    return h(
      'div',
      { class: 'ao-usage-line' },
      h('span', { class: 'ao-usage-label' }, label),
      h('span', { class: 'ao-usage-value' }, `${formatTokens(tokens)} · ${formatCost(cost)}`),
    );
  }

  private tooltip(label: string, usage: AccountUsage): string {
    const now = this.ctx.now();
    return [
      t('usage.tip.account', { label }),
      t('usage.tip.window', { tokens: formatTokens(usage.window5h.tokens), cost: formatCost(usage.window5h.costUSD), reset: formatResetIn(usage.window5h.resetsAt, now) }),
      t('usage.tip.week', { tokens: formatTokens(usage.week.tokens), cost: formatCost(usage.week.costUSD), reset: formatResetIn(usage.week.resetsAt, now) }),
      t('usage.tip.today', { tokens: formatTokens(usage.today.tokens), cost: formatCost(usage.today.costUSD) }),
    ].join('\n');
  }
}
