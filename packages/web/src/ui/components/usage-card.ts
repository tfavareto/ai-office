// One account's usage card (tokens and estimated cost), shared by the top bar strip and the overflow popover.
import type { AccountUsage } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { accountLabel } from '../display';
import { h } from '../dom';
import { formatClock, formatCost, formatResetIn, formatTokens } from '../format';
import { icon } from '../icons';
import { imminentForAccount } from '../model/usage-forecast';
import { accountChip } from '../widgets';

function figure(tokens: number, cost: number): string {
  return `${formatTokens(tokens)} · ${formatCost(cost)}`;
}

function line(label: string, tokens: number, cost: number): HTMLElement {
  return h(
    'div',
    { class: 'ao-usage-line' },
    h('span', { class: 'ao-usage-label' }, label),
    h('span', { class: 'ao-usage-value' }, figure(tokens, cost)),
  );
}

function tooltip(ctx: AppContext, label: string, usage: AccountUsage): string {
  const now = ctx.now();
  const hit = imminentForAccount(usage, ctx.prefs.get().usageLimits[usage.accountId], now)?.hitsAt;
  return [
    t('usage.tip.account', { label }),
    t('usage.tip.window', {
      tokens: formatTokens(usage.window5h.tokens),
      cost: formatCost(usage.window5h.costUSD),
      reset: formatResetIn(usage.window5h.resetsAt, now),
    }),
    t('usage.tip.week', {
      tokens: formatTokens(usage.week.tokens),
      cost: formatCost(usage.week.costUSD),
      reset: formatResetIn(usage.week.resetsAt, now),
    }),
    t('usage.tip.today', { tokens: formatTokens(usage.today.tokens), cost: formatCost(usage.today.costUSD) }),
    ...(hit === undefined ? [] : [t('usage.tip.hit', { time: formatClock(hit) })]),
    t('usage.tip.open'),
  ].join('\n');
}

/** Opens the usage dialog on this account. */
function openUsage(ctx: AppContext, accountId: string): void {
  ctx.ui.set({ dialog: 'usage', popover: null, usageAccount: accountId });
}

/**
 * Bar form: account chip plus the two lines (5 h, week). The compact figure (chip and the 5 h figure) is built in too;
 * the strip's `is-compact` class chooses which one shows. The popover form (`detailed`) lists the three windows.
 * The card is a button that opens the detailed usage; an amber ring and mark warn when the limit is about to be reached.
 */
export function usageCard(ctx: AppContext, accountId: string, usage: AccountUsage, detailed = false): HTMLElement {
  const account = ctx.account(accountId);
  const label = account ? accountLabel(account) : t('usage.account');
  const lines = [
    line(t('usage.window5h'), usage.window5h.tokens, usage.window5h.costUSD),
    line(t('usage.week'), usage.week.tokens, usage.week.costUSD),
  ];
  if (detailed) lines.push(line(t('usage.today'), usage.today.tokens, usage.today.costUSD));
  const warning = imminentForAccount(usage, ctx.prefs.get().usageLimits[accountId], ctx.now()) !== undefined;
  const card = h(
    'button',
    {
      type: 'button',
      class: ['ao-usage-card', detailed ? 'ao-usage-card--detail' : '', warning ? 'is-warning' : '']
        .filter(Boolean)
        .join(' '),
      'aria-label': t('usage.open', { label }),
      title: tooltip(ctx, label, usage),
      onclick: () => openUsage(ctx, accountId),
    },
    accountChip(account, detailed),
    h('div', { class: 'ao-usage-lines' }, ...lines),
    detailed
      ? null
      : h('div', { class: 'ao-usage-short' }, line(t('usage.window5h'), usage.window5h.tokens, usage.window5h.costUSD)),
    warning ? h('span', { class: 'ao-usage-warn', 'aria-hidden': 'true' }, icon('alert', 11)) : null,
  );
  card.addEventListener('pointerenter', () => {
    card.title = tooltip(ctx, label, usage);
  });
  return card;
}

/** Cards of the accounts that have usage data, in account order. */
export function usageEntries(ctx: AppContext): { accountId: string; usage: AccountUsage }[] {
  const snapshot = ctx.snapshot;
  const usage = snapshot?.usage ?? [];
  return (snapshot?.accounts ?? []).flatMap((account) => {
    const entry = usage.find((u) => u.accountId === account.id);
    return entry ? [{ accountId: account.id, usage: entry }] : [];
  });
}

export function usageSignature(ctx: AppContext): string {
  const accounts = (ctx.snapshot?.accounts ?? []).map((a) => `${a.id}${a.label}${a.color}`).join(';');
  const limits = ctx.prefs.get().usageLimits;
  const now = ctx.now();
  const rows = usageEntries(ctx).map(({ usage: u }) => {
    const warning = imminentForAccount(u, limits[u.accountId], now) !== undefined ? 'w' : '';
    return `${u.accountId}:${u.window5h.tokens}:${Math.round(u.window5h.costUSD * 100)}:${u.week.tokens}:${Math.round(u.week.costUSD * 100)}:${u.today.tokens}:${Math.round(u.today.costUSD * 100)}:${warning}`;
  });
  return `${accounts}|${rows.join(',')}`;
}
