// The 5 h window gauge and the limit forecast of each account in the usage dialog, plus its limits form.
import type { Account, AccountUsage, UsageWindowInfo } from '@ai-office/shared';
import { WINDOW_MS } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { h } from '../dom';
import { formatCost, formatDuration, formatResetIn, formatShare, formatTokens } from '../format';
import { type ForecastLine, forecastLines, formatAmount } from '../model/usage-forecast';
import { accountChip } from '../widgets';
import { UsageLimitsForm } from './usage-limits-form';

const FULL = 100;

function meter(label: string, percent: number, valueText: string, tone: string): HTMLElement {
  const bounded = Math.max(0, Math.min(FULL, percent));
  return h(
    'div',
    { class: `ao-usage-meter ao-usage-meter--${tone}` },
    h('div', { class: 'ao-usage-meter-head' }, h('span', null, label), h('strong', null, valueText)),
    h('div', { class: 'ao-usage-meter-track', role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': FULL, 'aria-valuenow': Math.round(bounded), 'aria-valuetext': valueText }, h('span', { style: `width:${bounded.toFixed(1)}%` })),
  );
}

function windowMeters(window: UsageWindowInfo | undefined, usage: AccountUsage, windowLine: ForecastLine, now: number): HTMLElement {
  const active = window?.active ?? usage.window5h.tokens > 0;
  if (!active) return h('p', { class: 'ao-usage-idle' }, t('usage.window.idle'));
  const start = window?.start ?? usage.window5h.resetsAt - WINDOW_MS;
  const resetsAt = window?.resetsAt ?? usage.window5h.resetsAt;
  const elapsed = Math.max(0, Math.min(WINDOW_MS, now - start));
  const forecast = windowLine.forecast;
  const timeMeter = meter(t('usage.gauge.time'), (elapsed / WINDOW_MS) * FULL, t('usage.gauge.timeValue', { elapsed: formatDuration(elapsed), reset: formatResetIn(resetsAt, now) }), 'time');
  const share = forecast.limit === undefined ? undefined : forecast.used / forecast.limit;
  const usageText = share === undefined ? t('usage.gauge.noReference') : t('usage.gauge.usageValue', { used: formatAmount(forecast.used, forecast.unit), limit: formatAmount(forecast.limit ?? 0, forecast.unit), share: formatShare(share) });
  const usageMeter = meter(t('usage.gauge.usage'), share === undefined ? 0 : share * FULL, usageText, share === undefined ? 'muted' : windowLine.tone);
  const used = h('p', { class: 'ao-usage-window-used' }, t('usage.window.used', { tokens: formatTokens(window?.tokens ?? usage.window5h.tokens), cost: formatCost(window?.costUSD ?? usage.window5h.costUSD) }));
  return h('div', { class: 'ao-usage-meters' }, used, timeMeter, usageMeter);
}

function forecastBlock(line: ForecastLine): HTMLElement {
  return h(
    'section',
    { class: `ao-usage-forecast ao-usage-forecast--${line.tone}` },
    h('h4', null, t(line.scope === 'window5h' ? 'usage.forecast.scope.window5h' : 'usage.forecast.scope.week')),
    ...line.sentences.map((sentence, index) => h('p', { class: index === 0 || sentence.key === 'usage.forecast.none' ? 'ao-usage-forecast-main' : 'ao-usage-forecast-more' }, t(sentence.key, sentence.params))),
    line.reference === undefined ? null : h('p', { class: 'ao-usage-forecast-ref' }, t(line.reference.key, line.reference.params)),
  );
}

interface AccountBlock {
  el: HTMLElement;
  body: HTMLElement;
  form: UsageLimitsForm;
}

export class UsageForecastPanel {
  readonly el = h('section', { class: 'ao-usage-forecasts', 'aria-labelledby': 'ao-usage-forecast-h' });
  private readonly blocks = new Map<string, AccountBlock>();
  private order = '';
  private signature = '';

  constructor(private readonly ctx: AppContext) {
    this.el.append(h('h3', { id: 'ao-usage-forecast-h', class: 'ao-usage-h' }, t('usage.forecast.title')), h('p', { class: 'ao-usage-estimate' }, t('usage.forecast.estimate')));
  }

  /** Shows the accounts in `accountIds`. Cheap when nothing changed (the data and the minute are the same). */
  update(accountIds: readonly string[], windows: readonly UsageWindowInfo[], now: number): void {
    this.syncBlocks(accountIds);
    const limits = this.ctx.prefs.get().usageLimits;
    const usages = this.ctx.snapshot?.usage ?? [];
    const signature = JSON.stringify([Math.floor(now / 60_000), windows, accountIds.map((id) => [usages.find((usage) => usage.accountId === id), limits[id]])]);
    if (signature === this.signature) return;
    this.signature = signature;
    for (const id of accountIds) {
      const block = this.blocks.get(id);
      const usage = usages.find((candidate) => candidate.accountId === id);
      if (block === undefined) continue;
      block.form.sync();
      if (usage === undefined) {
        block.body.replaceChildren(h('p', { class: 'ao-usage-idle' }, t('usage.empty')));
        continue;
      }
      const lines = forecastLines(usage, limits[id], now);
      block.body.replaceChildren(windowMeters(windows.find((window) => window.account === id), usage, lines[0] as ForecastLine, now), h('div', { class: 'ao-usage-forecast-grid' }, ...lines.map(forecastBlock)));
    }
  }

  private syncBlocks(accountIds: readonly string[]): void {
    const order = accountIds.join('|');
    if (order === this.order) return;
    this.order = order;
    this.signature = '';
    this.blocks.clear();
    const blocks = accountIds.map((id) => {
      const body = h('div', { class: 'ao-usage-account-body' });
      const form = new UsageLimitsForm(this.ctx, id);
      const account: Account | undefined = this.ctx.account(id);
      const el = h('article', { class: 'ao-usage-account' }, h('header', { class: 'ao-usage-account-head' }, accountChip(account, true)), body, form.el);
      this.blocks.set(id, { el, body, form });
      return el;
    });
    this.el.replaceChildren(...Array.from(this.el.children).slice(0, 2), ...blocks);
  }
}
