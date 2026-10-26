// "Meu dia": two tabs, the time per status per agent (Tempo) and what each agent did (Relatório).
import { reportDates } from '@ai-office/shared';
import { t } from '../../i18n';
import { localOnlyHint, type AppContext } from '../context';
import { h, toggleClass } from '../dom';
import { formatDateKey, shiftDateKey, toDateKey } from '../format';
import { icon } from '../icons';
import type { DayTab } from '../state';
import { button, createSegmented, setDisabled } from '../widgets';
import { DayTimeView } from './day-time-view';
import { Dialog, closeButton } from './overlay';
import { ReportView } from './report-view';

export class DayDialog extends Dialog {
  private readonly time: DayTimeView;
  private readonly report: ReportView;
  private readonly tabs = createSegmented<DayTab>(
    t('day.tabs'),
    [
      { value: 'time', label: t('day.tab.time') },
      { value: 'report', label: t('day.tab.report') },
    ],
    (tab) => {
      if (this.ctx.ui.get().dayTab !== tab) this.ctx.ui.set({ dayTab: tab });
    },
  );
  private readonly nav: HTMLElement;
  /** Date navigator and actions, on their own row below the header (the Time tab). */
  private readonly toolbar = h('div', { class: 'ao-day-toolbar' });
  private readonly actions = h('div', { class: 'ao-day-actions' });
  /** Right end of the header row: the close button, and the Watch button on the Report tab (which has no toolbar). */
  private readonly headEnd = h('div', { class: 'ao-day-head-end' });
  private readonly dateLabel = h('span', { class: 'ao-day-date' });
  private readonly nextBtn: HTMLButtonElement;
  private readonly watchBtn: HTMLButtonElement;
  private readonly shareBtn: HTMLButtonElement;
  private date = '';
  private tab: DayTab | null = null;

  constructor(ctx: AppContext) {
    super(ctx, 'day', 'ao-day-title', 'ao-dialog--day');
    this.time = new DayTimeView(ctx);
    this.report = new ReportView(ctx);
    const prev = h(
      'button',
      {
        type: 'button',
        class: 'ao-iconbtn ao-iconbtn--small',
        'aria-label': t('day.prev'),
        title: t('day.prev'),
        onclick: () => this.shift(-1),
      },
      icon('chevronLeft', 16),
    );
    this.nextBtn = h(
      'button',
      {
        type: 'button',
        class: 'ao-iconbtn ao-iconbtn--small',
        'aria-label': t('day.next'),
        title: t('day.next'),
        onclick: () => this.shift(1),
      },
      icon('chevronRight', 16),
    );
    this.nav = h('div', { class: 'ao-day-nav' }, prev, this.dateLabel, this.nextBtn);
    this.watchBtn = button({
      label: t('day.watch'),
      icon: 'play',
      variant: 'soft',
      title: t('day.watch.hint'),
      className: 'ao-day-watch',
      onClick: () => this.watch(),
    });
    this.shareBtn = button({
      label: t('share.button'),
      icon: 'camera',
      variant: 'soft',
      title: t('share.button.hint'),
      className: 'ao-day-share',
      onClick: () => ctx.openShare(this.shownDate()),
    });
    this.headEnd.append(closeButton(t('common.close'), () => ctx.closeDialog()));
    this.actions.append(this.shareBtn, this.watchBtn);
    this.toolbar.append(this.nav, this.actions);
    this.panel.append(
      h(
        'header',
        { class: 'ao-dialog-head ao-day-head' },
        h('h2', { id: 'ao-day-title' }, t('day.title')),
        this.tabs.el,
        this.headEnd,
      ),
      // The date navigator and the actions sit on their own row, so the title row never outgrows the box.
      this.toolbar,
      this.time.el,
      this.report.el,
    );
  }

  protected onOpen(): void {
    this.date = toDateKey(this.ctx.store.now());
    this.tab = null;
    this.report.show();
  }

  /** The day the open tab is showing. */
  private shownDate(): string {
    return this.ctx.ui.get().dayTab === 'report' ? this.report.day : this.date;
  }

  private watch(): void {
    const date = this.shownDate();
    this.ctx.closeDialog();
    this.ctx.startReplay(date);
  }

  private shift(days: number): void {
    const next = shiftDateKey(this.date, days);
    if (next > toDateKey(this.ctx.store.now())) return;
    this.date = next;
    this.time.show(this.date);
  }

  protected update(): void {
    const tab = this.ctx.ui.get().dayTab;
    const watchable = reportDates(this.ctx.store.now()).includes(this.shownDate());
    setDisabled(
      this.watchBtn,
      !this.ctx.store.isLocal || !watchable,
      !this.ctx.store.isLocal ? localOnlyHint() : undefined,
    );
    // The report tab has its own share button in the report toolbar.
    this.shareBtn.hidden = tab === 'report';
    setDisabled(this.shareBtn, !watchable);
    this.tabs.set(tab);
    if (tab !== this.tab) {
      this.tab = tab;
      this.time.el.hidden = tab !== 'time';
      this.report.el.hidden = tab !== 'report';
      this.nav.hidden = tab !== 'time';
      this.toolbar.hidden = tab !== 'time';
      if (tab === 'time') this.actions.append(this.watchBtn);
      else this.headEnd.prepend(this.watchBtn);
      toggleClass(this.panel, 'is-report', tab === 'report');
      if (tab === 'time') this.time.show(this.date);
    }
    if (tab === 'report') {
      this.report.update();
      return;
    }
    this.dateLabel.textContent =
      this.date === toDateKey(this.ctx.store.now())
        ? t('day.today', { date: formatDateKey(this.date) })
        : formatDateKey(this.date);
    this.nextBtn.disabled = this.date >= toDateKey(this.ctx.store.now());
    this.time.update();
  }
}
