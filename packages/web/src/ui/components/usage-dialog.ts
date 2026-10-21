// "Consumo": the detailed usage view. Today, this week or this month of one account (or all of them): totals, change
// against the previous period, tokens over time, the 5 h window, the limit forecast and the breakdown tables.
import { USAGE_PERIODS, type Account, type UsageDetail, type UsagePeriod } from '@ai-office/shared';
import { t } from '../../i18n';
import { describeError } from '../../net/backend';
import type { AppContext } from '../context';
import { accountLabel } from '../display';
import { type Child, h, setText } from '../dom';
import { formatChange, formatClock, formatCost, formatShare, formatTokens } from '../format';
import { icon } from '../icons';
import { STACK_ORDER } from '../model/usage-chart';
import { type Kpis, kpisOf, pickerAccounts, resolveAccount } from '../model/usage-view';
import { createSegmented, emptyNote, type Segmented } from '../widgets';
import { Dialog, closeButton } from './overlay';
import { UsageChart, chartLegend } from './usage-chart';
import { UsageForecastPanel } from './usage-forecast-panel';
import { modelsTable, projectsTable, sessionsTable } from './usage-tables';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const POLL_MS = 15_000;
const POLL_INDEXING_MS = 2000;
const RETRY_MS = 5000;
const ALL = 'all';

function tile(className: string, label: string, value: Child, ...rest: Child[]): HTMLElement {
  return h(
    'div',
    { class: `ao-usage-kpi ${className}`.trim() },
    h('span', { class: 'ao-usage-kpi-label' }, label),
    h('strong', { class: 'ao-usage-kpi-value' }, value),
    ...rest,
  );
}

function changeValue(change: number | undefined): Child[] {
  if (change === undefined) return ['—'];
  return [change === 0 ? null : icon(change > 0 ? 'arrowUp' : 'arrowDown', 16), formatChange(change)];
}

function kpiTiles(kpis: Kpis, detail: UsageDetail): HTMLElement[] {
  const compared = kpis.tokensChange !== undefined || kpis.costChange !== undefined;
  return [
    tile(
      '',
      t('usage.kpi.tokens'),
      formatTokens(kpis.tokens),
      h('span', { class: 'ao-usage-kpi-hint' }, t('usage.kpi.tokens.hint')),
    ),
    tile(
      '',
      t('usage.kpi.cost'),
      formatCost(kpis.costUSD),
      h('span', { class: 'ao-usage-kpi-hint' }, t('usage.kpi.cost.hint')),
    ),
    tile(
      'ao-usage-kpi--change',
      t('usage.kpi.change'),
      h('span', { class: 'ao-usage-change' }, ...changeValue(kpis.tokensChange)),
      h(
        'span',
        { class: 'ao-usage-kpi-hint' },
        compared
          ? t('usage.kpi.change.cost', { change: kpis.costChange === undefined ? '—' : formatChange(kpis.costChange) })
          : t('usage.kpi.change.none'),
      ),
      compared ? h('span', { class: 'ao-usage-kpi-hint' }, t(`usage.kpi.change.basis.${detail.period}`)) : null,
    ),
    tile(
      '',
      t('usage.kpi.cache'),
      formatShare(kpis.cacheHit),
      h('span', { class: 'ao-usage-kpi-hint' }, t('usage.kpi.cache.hint')),
    ),
  ];
}

export class UsageDialog extends Dialog {
  private readonly body = h('div', { class: 'ao-usage-body' });
  private readonly toolbar = h('div', { class: 'ao-usage-toolbar' });
  private readonly status = h('div', { class: 'ao-usage-status', role: 'status' });
  private readonly kpis = h('div', { class: 'ao-usage-kpis' });
  private readonly chartTitle = h('h3', { class: 'ao-usage-h', id: 'ao-usage-chart-h' });
  private readonly chartLegendHost = h('div', { class: 'ao-usage-legend-host' });
  private readonly chart = new UsageChart();
  private readonly chartNote = h('p', { class: 'ao-usage-chart-hint' }, t('usage.chart.hint'));
  private readonly cacheToggle = h('input', {
    type: 'checkbox',
    id: 'ao-usage-cache-toggle',
    onchange: () => this.toggleCache(),
  });
  private readonly forecast: UsageForecastPanel;
  private readonly tables = h('div', { class: 'ao-usage-tables' });
  private readonly sessions = h('div', { class: 'ao-usage-sessions' });
  private readonly footer = h('p', { class: 'ao-usage-footer' });
  private readonly updated = h('span', { class: 'ao-usage-updated' });
  private readonly demoBadge = h('span', { class: 'ao-usage-demo', hidden: true }, t('usage.demo'));
  private accountPicker: Segmented<string> | null = null;
  private pickerSignature = '';
  private readonly periodPicker: Segmented<UsagePeriod>;
  private account = ALL;
  private period: UsagePeriod = 'today';
  private includeCache = false;
  private state: LoadState = 'idle';
  private detail: UsageDetail | null = null;
  private dataSignature = '';
  private dataVersion = 0;
  private renderKey = '';
  private error = '';
  private token = 0;
  private timer: number | undefined;

  constructor(ctx: AppContext) {
    super(ctx, 'usage', 'ao-usage-title', 'ao-dialog--usage');
    this.forecast = new UsageForecastPanel(ctx);
    this.periodPicker = createSegmented<UsagePeriod>(
      t('usage.period.label'),
      USAGE_PERIODS.map((value) => ({ value, label: t(`usage.period.${value}`) })),
      (value) => this.setPeriod(value),
    );
    this.footer.append(t('usage.footer'), ' ', this.updated, this.demoBadge);
    const chartCard = h(
      'section',
      { class: 'ao-usage-card-block ao-usage-chartcard', 'aria-labelledby': 'ao-usage-chart-h' },
      h(
        'div',
        { class: 'ao-usage-chartcard-head' },
        this.chartTitle,
        h(
          'label',
          { class: 'ao-check', for: 'ao-usage-cache-toggle' },
          this.cacheToggle,
          h('span', null, t('usage.chart.cacheToggle')),
        ),
      ),
      this.chartLegendHost,
      this.chart.el,
      this.chartNote,
    );
    this.body.append(this.status, this.kpis, chartCard, this.forecast.el, this.tables, this.sessions, this.footer);
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head' },
        h(
          'div',
          { class: 'ao-usage-heading' },
          h('h2', { id: 'ao-usage-title' }, t('usage.dialog.title')),
          h('p', null, t('usage.dialog.subtitle')),
        ),
        closeButton(t('common.close'), () => ctx.closeDialog()),
      ),
      this.toolbar,
      this.body,
    );
    this.toolbar.append(h('div', { class: 'ao-usage-toolbar-group' }), this.periodPicker.el);
  }

  // ---- lifecycle ----------------------------------------------------------------------------------------------

  protected override onOpen(): void {
    const requested = this.ctx.ui.get().usageAccount;
    if (requested !== null) this.ctx.ui.set({ usageAccount: null });
    this.account = resolveAccount(requested ?? this.account, this.accountIds());
    this.detail = null;
    this.dataSignature = '';
    this.renderKey = '';
    void this.load();
  }

  protected override onClose(): void {
    this.token++;
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private accounts(): Account[] {
    return this.ctx.snapshot?.accounts ?? [];
  }

  private accountIds(): string[] {
    return this.accounts().map((account) => account.id);
  }

  private setAccount(account: string): void {
    if (account === this.account) return;
    this.account = account;
    void this.load();
  }

  private setPeriod(period: UsagePeriod): void {
    if (period === this.period) return;
    this.period = period;
    void this.load();
  }

  private toggleCache(): void {
    this.includeCache = this.cacheToggle.checked;
    this.ctx.refresh();
  }

  // ---- data ---------------------------------------------------------------------------------------------------

  private async load(): Promise<void> {
    const token = ++this.token;
    window.clearTimeout(this.timer);
    if (this.detail === null) this.state = 'loading';
    this.ctx.refresh();
    try {
      const detail = await this.ctx.store.backend.usageDetail(this.account, this.period);
      if (token !== this.token) return;
      const signature = JSON.stringify({ ...detail, generatedAt: 0, progress: detail.progress });
      if (signature !== this.dataSignature) {
        this.dataSignature = signature;
        this.dataVersion++;
        this.detail = detail;
      } else if (this.detail !== null) {
        this.detail = { ...this.detail, generatedAt: detail.generatedAt };
      }
      this.state = 'ready';
      this.schedule(detail.progress.state === 'indexing' ? POLL_INDEXING_MS : POLL_MS);
    } catch (error) {
      if (token !== this.token) return;
      this.error = describeError(error);
      if (this.detail === null) this.state = 'error';
      this.schedule(RETRY_MS);
    }
    this.ctx.refresh();
  }

  private schedule(delay: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.load(), delay);
  }

  // ---- rendering ----------------------------------------------------------------------------------------------

  protected override update(): void {
    this.syncToolbar();
    this.body.setAttribute('aria-busy', String(this.state === 'loading'));
    const detail = this.detail;
    if (detail === null) {
      this.renderEmpty();
      return;
    }
    this.renderStatus(detail);
    const accounts = this.account === ALL ? this.accountIds() : [this.account];
    this.forecast.update(accounts, detail.windows, this.ctx.now());
    const key = `${this.dataVersion}|${this.includeCache}|${this.linksSignature(detail)}`;
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.renderDetail(detail);
  }

  /** Which sessions and projects of the tables are open in the office (they are links only then). */
  private linksSignature(detail: UsageDetail): string {
    return [
      ...detail.bySession.map((row) =>
        row.officeId !== undefined && this.ctx.agent(row.officeId) !== undefined ? 1 : 0,
      ),
      ...detail.bySession.map((row) => (this.ctx.project(row.project) !== undefined ? 1 : 0)),
      ...detail.byProject.map((row) => (this.ctx.project(row.project) !== undefined ? 1 : 0)),
    ].join('');
  }

  private syncToolbar(): void {
    const accounts = this.accounts();
    const ids = accounts.map((account) => account.id);
    const signature = `${ids.join('|')}|${accounts.map(accountLabel).join('|')}`;
    if (signature !== this.pickerSignature) {
      this.pickerSignature = signature;
      this.account = resolveAccount(this.account, ids);
      const labels = new Map(accounts.map((account) => [account.id, accountLabel(account)]));
      const options = pickerAccounts(ids).map((value) => ({
        value,
        label: value === ALL ? t('usage.account.all') : (labels.get(value) ?? value),
      }));
      const picker = createSegmented<string>(t('usage.account.label'), options, (value) => this.setAccount(value));
      this.accountPicker = picker;
      (this.toolbar.firstElementChild as HTMLElement).replaceChildren(picker.el);
      if (ids.length <= 1) this.account = ids[0] ?? ALL;
    }
    this.accountPicker?.set(this.account);
    (this.toolbar.firstElementChild as HTMLElement).hidden = ids.length <= 1;
    this.periodPicker.set(this.period);
  }

  private renderEmpty(): void {
    this.kpis.replaceChildren();
    this.tables.replaceChildren();
    this.sessions.replaceChildren();
    this.chartLegendHost.replaceChildren();
    if (this.state === 'error') {
      this.status.replaceChildren(
        h('p', { class: 'ao-error' }, this.error),
        h(
          'button',
          { type: 'button', class: 'ao-btn ao-btn--soft', onclick: () => void this.load() },
          t('common.retry'),
        ),
      );
    } else {
      this.status.replaceChildren(emptyNote(t('usage.loading')));
    }
  }

  private renderStatus(detail: UsageDetail): void {
    if (detail.progress.state !== 'indexing') {
      this.status.replaceChildren();
      return;
    }
    const percent = Math.round(detail.progress.percent);
    this.status.replaceChildren(
      h(
        'div',
        { class: 'ao-usage-progress' },
        h('strong', null, t('usage.indexing', { percent })),
        h(
          'div',
          {
            class: 'ao-usage-meter-track',
            role: 'progressbar',
            'aria-label': t('usage.indexing', { percent }),
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': percent,
          },
          h('span', { style: `width:${percent}%` }),
        ),
        h('span', { class: 'ao-usage-kpi-hint' }, t('usage.indexing.hint')),
      ),
    );
  }

  private renderDetail(detail: UsageDetail): void {
    const kpis = kpisOf(detail);
    this.kpis.replaceChildren(...kpiTiles(kpis, detail));
    this.chartTitle.textContent = t(detail.granularity === 'hour' ? 'usage.chart.title.hour' : 'usage.chart.title.day');
    this.cacheToggle.checked = this.includeCache;
    this.chartLegendHost.replaceChildren(
      chartLegend(this.includeCache ? STACK_ORDER : STACK_ORDER.filter((kind) => kind !== 'cacheRead')),
    );
    this.chart.set(detail, this.includeCache, this.ctx.now());
    if (kpis.hasData) {
      this.tables.replaceChildren(modelsTable(detail), projectsTable(this.ctx, detail));
      this.sessions.replaceChildren(sessionsTable(this.ctx, detail));
    } else {
      this.tables.replaceChildren(emptyNote(t('usage.empty')));
      this.sessions.replaceChildren();
    }
    setText(this.updated, t('usage.updated', { time: formatClock(detail.generatedAt) }));
    this.demoBadge.hidden = detail.demo !== true;
  }

  dispose(): void {
    this.onClose();
    this.chart.dispose();
  }
}
