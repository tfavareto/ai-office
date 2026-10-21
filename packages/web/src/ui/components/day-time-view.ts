// "Meu dia", Tempo tab: time per status per agent (stacked bars) and totals for one recorded day.
import type { DayStats } from '@ai-office/shared';
import { t } from '../../i18n';
import { describeError } from '../../net/backend';
import type { AppContext } from '../context';
import { h } from '../dom';
import { formatDuration } from '../format';
import { DAY_STATUSES, aggregateDay, dayStatusLabel, type DayStatus, type DayView } from '../model/day';
import { emptyNote } from '../widgets';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export class DayTimeView {
  readonly el = h('div', { class: 'ao-day-body' });
  private date = '';
  private state: LoadState = 'idle';
  private view: DayView | null = null;
  private error = '';
  private token = 0;
  private signature = '';

  constructor(private readonly ctx: AppContext) {}

  /** Shows another day (loads it). */
  show(date: string): void {
    this.date = date;
    void this.load();
  }

  private async load(): Promise<void> {
    const token = ++this.token;
    this.state = 'loading';
    this.signature = '';
    this.ctx.refresh();
    try {
      const stats: DayStats = await this.ctx.store.backend.day(this.date);
      if (token !== this.token) return;
      this.view = aggregateDay(stats);
      this.state = 'ready';
    } catch (error) {
      if (token !== this.token) return;
      this.state = 'error';
      this.error = describeError(error);
    }
    this.signature = '';
    this.ctx.refresh();
  }

  update(): void {
    const signature = `${this.state}|${this.date}|${this.view?.totalMs ?? 0}|${this.view?.rows.length ?? 0}`;
    if (signature === this.signature) return;
    this.signature = signature;
    if (this.state === 'loading') {
      this.el.replaceChildren(emptyNote(t('day.loading')));
    } else if (this.state === 'error') {
      this.el.replaceChildren(h('p', { class: 'ao-error' }, this.error), h('button', { type: 'button', class: 'ao-btn ao-btn--soft', onclick: () => void this.load() }, t('common.retry')));
    } else if (!this.view || this.view.rows.length === 0) {
      this.el.replaceChildren(emptyNote(t('day.empty')));
    } else {
      this.el.replaceChildren(this.totals(this.view), this.legend(), this.bars(this.view));
    }
  }

  private totals(view: DayView): HTMLElement {
    return h(
      'div',
      { class: 'ao-day-totals' },
      ...DAY_STATUSES.map((status) => h('div', { class: `ao-day-total ao-day-total--${status}` }, h('span', { class: 'ao-day-total-label' }, dayStatusLabel(status)), h('strong', null, formatDuration(view.totals[status])))),
    );
  }

  private legend(): HTMLElement {
    return h('ul', { class: 'ao-day-legend', 'aria-hidden': 'true' }, ...DAY_STATUSES.map((status) => h('li', null, h('span', { class: `ao-day-swatch ao-day-seg--${status}` }), dayStatusLabel(status))));
  }

  private bars(view: DayView): HTMLElement {
    return h(
      'ul',
      { class: 'ao-day-rows' },
      ...view.rows.map((row) => {
        const summary = DAY_STATUSES.map((status: DayStatus) => `${dayStatusLabel(status)} ${formatDuration(row.segments.find((s) => s.status === status)?.ms ?? 0)}`).join(', ');
        return h(
          'li',
          { class: 'ao-day-row' },
          h('div', { class: 'ao-day-row-head' }, h('strong', null, row.name), h('span', { class: 'ao-day-row-room' }, this.ctx.project(row.projectId)?.name ?? ''), h('span', { class: 'ao-day-row-total' }, formatDuration(row.totalMs))),
          h(
            'div',
            { class: 'ao-day-bar', role: 'img', 'aria-label': `${row.name}: ${summary}` },
            ...row.segments.filter((s) => s.ms > 0).map((s) => h('span', { class: `ao-day-seg ao-day-seg--${s.status}`, style: `width:${s.widthPct}%`, title: `${dayStatusLabel(s.status)}: ${formatDuration(s.ms)}` })),
          ),
        );
      }),
    );
  }
}
