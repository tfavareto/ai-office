// "Meu dia": time per status per agent (stacked bars) and totals, for any of the recorded days.
import type { DayStats } from '@ai-office/shared';
import { describeError } from '../../net/backend';
import type { AppContext } from '../context';
import { h } from '../dom';
import { formatDateKey, formatDuration, shiftDateKey, toDateKey } from '../format';
import { icon } from '../icons';
import { DAY_STATUSES, DAY_STATUS_LABEL, aggregateDay, type DayStatus, type DayView } from '../model/day';
import { emptyNote } from '../widgets';
import { Dialog, closeButton } from './overlay';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export class DayDialog extends Dialog {
  private readonly body = h('div', { class: 'ao-day-body' });
  private readonly dateLabel = h('span', { class: 'ao-day-date' });
  private readonly nextBtn: HTMLButtonElement;
  private date = '';
  private state: LoadState = 'idle';
  private view: DayView | null = null;
  private error = '';
  private token = 0;
  private signature = '';

  constructor(ctx: AppContext) {
    super(ctx, 'day', 'ao-day-title', 'ao-dialog--day');
    const prev = h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': 'Dia anterior', title: 'Dia anterior', onclick: () => this.shift(-1) }, icon('chevronLeft', 16));
    this.nextBtn = h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': 'Próximo dia', title: 'Próximo dia', onclick: () => this.shift(1) }, icon('chevronRight', 16));
    this.panel.append(
      h('header', { class: 'ao-dialog-head' }, h('h2', { id: 'ao-day-title' }, 'Meu dia'), h('div', { class: 'ao-day-nav' }, prev, this.dateLabel, this.nextBtn), closeButton('Fechar', () => ctx.closeDialog())),
      this.body,
    );
  }

  protected onOpen(): void {
    this.date = toDateKey(this.ctx.now());
    void this.load();
  }

  private shift(days: number): void {
    const next = shiftDateKey(this.date, days);
    if (next > toDateKey(this.ctx.now())) return;
    this.date = next;
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

  protected update(): void {
    this.dateLabel.textContent = this.date === toDateKey(this.ctx.now()) ? `Hoje · ${formatDateKey(this.date)}` : formatDateKey(this.date);
    this.nextBtn.disabled = this.date >= toDateKey(this.ctx.now());
    const signature = `${this.state}|${this.date}|${this.view?.totalMs ?? 0}|${this.view?.rows.length ?? 0}`;
    if (signature === this.signature) return;
    this.signature = signature;
    if (this.state === 'loading') {
      this.body.replaceChildren(emptyNote('Carregando o dia…'));
    } else if (this.state === 'error') {
      this.body.replaceChildren(h('p', { class: 'ao-error' }, this.error), h('button', { type: 'button', class: 'ao-btn ao-btn--soft', onclick: () => void this.load() }, 'Tentar de novo'));
    } else if (!this.view || this.view.rows.length === 0) {
      this.body.replaceChildren(emptyNote('Nenhuma atividade registrada neste dia.'));
    } else {
      this.body.replaceChildren(this.totals(this.view), this.legend(), this.bars(this.view));
    }
  }

  private totals(view: DayView): HTMLElement {
    return h(
      'div',
      { class: 'ao-day-totals' },
      ...DAY_STATUSES.map((status) => h('div', { class: `ao-day-total ao-day-total--${status}` }, h('span', { class: 'ao-day-total-label' }, DAY_STATUS_LABEL[status]), h('strong', null, formatDuration(view.totals[status])))),
    );
  }

  private legend(): HTMLElement {
    return h('ul', { class: 'ao-day-legend', 'aria-hidden': 'true' }, ...DAY_STATUSES.map((status) => h('li', null, h('span', { class: `ao-day-swatch ao-day-seg--${status}` }), DAY_STATUS_LABEL[status])));
  }

  private bars(view: DayView): HTMLElement {
    return h(
      'ul',
      { class: 'ao-day-rows' },
      ...view.rows.map((row) => {
        const summary = DAY_STATUSES.map((status: DayStatus) => `${DAY_STATUS_LABEL[status]} ${formatDuration(row.segments.find((s) => s.status === status)?.ms ?? 0)}`).join(', ');
        return h(
          'li',
          { class: 'ao-day-row' },
          h('div', { class: 'ao-day-row-head' }, h('strong', null, row.name), h('span', { class: 'ao-day-row-room' }, this.ctx.project(row.projectId)?.name ?? ''), h('span', { class: 'ao-day-row-total' }, formatDuration(row.totalMs))),
          h(
            'div',
            { class: 'ao-day-bar', role: 'img', 'aria-label': `${row.name}: ${summary}` },
            ...row.segments.filter((s) => s.ms > 0).map((s) => h('span', { class: `ao-day-seg ao-day-seg--${s.status}`, style: `width:${s.widthPct}%`, title: `${DAY_STATUS_LABEL[s.status]}: ${formatDuration(s.ms)}` })),
          ),
        );
      }),
    );
  }
}
