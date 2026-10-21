// "Meu dia", Relatório tab: what each agent did on one of the last seven days, with a day picker, grouping, the
// opt-in for the user's requests, and the Markdown export (copy / download).
import { type DayReport, dayRange, hasActivity, reportDates } from '@ai-office/shared';
import { t } from '../../i18n';
import { describeError } from '../../net/backend';
import type { AppContext } from '../context';
import { accountLabel } from '../display';
import { h, setAttr, toggleClass } from '../dom';
import { formatDateKey, toDateKey } from '../format';
import { reportFilename, reportHighlights, type ReportGroupBy } from '../model/report';
import { renderReportMarkdown } from '../model/report-markdown';
import { button, createSegmented, createSwitch, emptyNote, setDisabled } from '../widgets';
import { pickerLabel } from './report-parts';
import { reportBody } from './report-sections';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/** Today's report is rebuilt this often while the tab is open. */
const REFRESH_MS = 60_000;
const REVOKE_DELAY_MS = 1000;

export class ReportView {
  readonly el: HTMLElement;
  private readonly picker = h('div', { class: 'ao-report-days', role: 'group', 'aria-label': t('report.days') });
  private readonly notices = h('div', { class: 'ao-report-notices' });
  private readonly content = h('div', { class: 'ao-report-content' });
  private readonly groupSegment = createSegmented<ReportGroupBy>(t('report.group'), [{ value: 'project', label: t('report.group.project') }, { value: 'agent', label: t('report.group.agent') }], (value) => this.setGroup(value));
  private readonly requestsSwitch = createSwitch(t('report.requests'), (on) => this.setRequests(on));
  private readonly copyBtn = button({ label: t('report.copy'), icon: 'copy', onClick: () => this.copyMarkdown() });
  private readonly downloadBtn = button({ label: t('report.download'), icon: 'arrowDown', onClick: () => this.download() });
  private date = '';
  private groupBy: ReportGroupBy = 'project';
  private includeRequests = false;
  private state: LoadState = 'idle';
  private report: DayReport | null = null;
  private error = '';
  private token = 0;
  private loadedKey = '';
  private loadedAt = 0;
  private signature = '';
  private pickerSignature = '';

  constructor(private readonly ctx: AppContext) {
    this.requestsSwitch.el.title = t('report.requests.hint');
    const requests = h('label', { class: 'ao-switch-row', title: t('report.requests.hint') }, h('span', null, t('report.requests')), this.requestsSwitch.el);
    const toolbar = h(
      'div',
      { class: 'ao-report-toolbar' },
      this.picker,
      h('div', { class: 'ao-report-options' }, this.groupSegment.el, requests, h('span', { class: 'ao-report-spacer' }), this.copyBtn, this.downloadBtn),
    );
    this.el = h('div', { class: 'ao-report' }, toolbar, this.notices, this.content);
  }

  /** The tab was opened: start on today. */
  show(): void {
    this.date = toDateKey(this.ctx.now());
    this.includeRequests = false;
    this.loadedKey = '';
    this.report = null;
    this.state = 'idle';
    this.pickerSignature = '';
  }

  private account(): string {
    const filter = this.ctx.ui.get().accountFilter;
    return filter.length === 1 ? (filter[0] as string) : 'all';
  }

  private setDate(date: string): void {
    if (date === this.date) return;
    this.date = date;
    this.ctx.refresh();
  }

  private setGroup(value: ReportGroupBy): void {
    this.groupBy = value;
    this.signature = '';
    this.ctx.refresh();
  }

  private setRequests(on: boolean): void {
    this.includeRequests = on;
    this.ctx.refresh();
  }

  private async load(quiet: boolean): Promise<void> {
    const token = ++this.token;
    this.loadedKey = this.key();
    this.loadedAt = this.ctx.now();
    if (!quiet || this.report === null) this.state = 'loading';
    this.signature = '';
    this.ctx.refresh();
    try {
      const report = await this.ctx.store.backend.dayReport({ date: this.date, account: this.account(), includeRequests: this.includeRequests });
      if (token !== this.token) return;
      this.report = report;
      this.state = 'ready';
    } catch (error) {
      if (token !== this.token) return;
      this.state = 'error';
      this.error = describeError(error);
    }
    this.signature = '';
    this.ctx.refresh();
  }

  private key(): string {
    return `${this.date}|${this.account()}|${this.includeRequests}`;
  }

  // ---- export -----------------------------------------------------------------------------------------------

  private markdown(): string | null {
    if (this.report === null || this.state !== 'ready') return null;
    const account = this.report.account === 'all' ? undefined : this.ctx.account(this.report.account);
    return renderReportMarkdown(this.report, { groupBy: this.groupBy, ...(account !== undefined ? { accountLabel: accountLabel(account) } : {}) });
  }

  private copyMarkdown(): void {
    const text = this.markdown();
    if (text !== null) this.ctx.copy(text, t('report.copied'));
  }

  private download(): void {
    const text = this.markdown();
    if (text === null || this.report === null) return;
    const name = reportFilename(this.report.date);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = h('a', { href: url, download: name, class: 'ao-visually-hidden' });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    this.ctx.notifyLocal('success', { key: 'report.downloaded', params: { name } });
  }

  // ---- render -----------------------------------------------------------------------------------------------

  update(): void {
    this.syncControls();
    const key = this.key();
    const stale = this.state === 'ready' && this.date === toDateKey(this.ctx.now()) && this.ctx.now() - this.loadedAt >= REFRESH_MS;
    if (this.state !== 'loading' && (key !== this.loadedKey || stale)) void this.load(key === this.loadedKey);
    const signature = `${this.state}|${this.report?.generatedAt ?? 0}|${this.groupBy}|${this.report?.includeRequests ?? false}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.renderContent();
  }

  private syncControls(): void {
    const dates = reportDates(this.ctx.now());
    const signature = `${dates.join(',')}|${this.date}`;
    if (signature !== this.pickerSignature) {
      this.pickerSignature = signature;
      this.picker.replaceChildren(
        ...dates.map((date, index) => {
          const on = date === this.date;
          return h('button', { type: 'button', class: `ao-chip${on ? ' is-on' : ''}`, 'aria-pressed': String(on), title: formatDateKey(date), onclick: () => this.setDate(date) }, h('span', null, pickerLabel(date, index)));
        }),
      );
    }
    this.groupSegment.set(this.groupBy);
    this.requestsSwitch.set(this.includeRequests);
    const exportable = this.state === 'ready' && this.report !== null && hasActivity(this.report);
    setDisabled(this.copyBtn, !exportable);
    setDisabled(this.downloadBtn, !exportable);
    setAttr(this.content, 'aria-busy', String(this.state === 'loading'));
    toggleClass(this.content, 'is-loading', this.state === 'loading');
  }

  private renderContent(): void {
    const report = this.report;
    this.notices.replaceChildren();
    if (this.state === 'loading' && report === null) return this.content.replaceChildren(emptyNote(t('report.loading')));
    if (this.state === 'error') return this.content.replaceChildren(h('p', { class: 'ao-error' }, this.error), h('button', { type: 'button', class: 'ao-btn ao-btn--soft', onclick: () => void this.load(false) }, t('common.retry')));
    if (report === null) return;
    const notices = [report.demo === true ? t('report.notice.demo') : null, report.usageIndexing === true ? t('report.notice.indexing') : null, report.truncated === true ? t('report.notice.truncated') : null];
    this.notices.replaceChildren(...notices.filter((text): text is string => text !== null).map((text) => h('p', { class: 'ao-report-notice' }, text)));
    if (!hasActivity(report)) return this.content.replaceChildren(emptyNote(t('report.empty')));
    const start = dayRange(report.date)?.start ?? this.ctx.now();
    this.content.replaceChildren(...reportBody(report, start, this.groupBy, reportHighlights(report)));
  }
}
