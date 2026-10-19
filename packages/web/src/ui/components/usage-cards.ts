// Usage cards in the top bar: tokens and estimated cost per account (5 h window, week, today).
import type { AccountUsage } from '@ai-office/shared';
import type { AppContext, Component } from '../context';
import { h } from '../dom';
import { formatCost, formatResetIn, formatTokens } from '../format';
import { accountChip } from '../widgets';

function usageSignature(usage: readonly AccountUsage[], accountIds: string): string {
  return `${accountIds}|${usage.map((u) => `${u.accountId}:${u.window5h.tokens}:${Math.round(u.window5h.costUSD * 100)}:${u.week.tokens}:${Math.round(u.week.costUSD * 100)}:${u.today.tokens}`).join(',')}`;
}

export class UsageCards implements Component {
  readonly el = h('div', { class: 'ao-usage', role: 'list', 'aria-label': 'Uso por conta' });
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
      { class: 'ao-usage-card', role: 'listitem', tabindex: '0', title: this.tooltip(account?.label ?? 'Conta', usage) },
      accountChip(account),
      h(
        'div',
        { class: 'ao-usage-lines' },
        this.line('5 h', usage.window5h.tokens, usage.window5h.costUSD),
        this.line('Semana', usage.week.tokens, usage.week.costUSD),
      ),
    );
    card.addEventListener('pointerenter', () => {
      card.title = this.tooltip(account?.label ?? 'Conta', usage);
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
      `Conta ${label} (estimativa local, preços públicos da API)`,
      `Janela de 5 h: ${formatTokens(usage.window5h.tokens)} tokens · ${formatCost(usage.window5h.costUSD)} (reinicia ${formatResetIn(usage.window5h.resetsAt, now)})`,
      `Semana: ${formatTokens(usage.week.tokens)} tokens · ${formatCost(usage.week.costUSD)} (reinicia ${formatResetIn(usage.week.resetsAt, now)})`,
      `Hoje: ${formatTokens(usage.today.tokens)} tokens · ${formatCost(usage.today.costUSD)}`,
    ].join('\n');
  }
}
