// Shown over the world when no session is open: how to start, plus a shortcut to demo mode.
import { describeError } from '../../net/backend';
import { t } from '../../i18n';
import { localOnlyHint, type AppContext, type Component } from '../context';
import { h, toggleClass } from '../dom';
import { computeCounters } from '../model/counters';
import { button, setDisabled } from '../widgets';

export class EmptyState implements Component {
  readonly el = h('div', { class: 'ao-empty', hidden: true });
  private readonly demoBtn: HTMLButtonElement;
  private readonly hireBtn: HTMLButtonElement;
  private busy = false;

  constructor(private readonly ctx: AppContext) {
    this.demoBtn = button({
      label: t('empty.demo'),
      icon: 'play',
      variant: 'primary',
      onClick: () => void this.enableDemo(),
    });
    this.hireBtn = button({ label: t('hire.action'), icon: 'plus', variant: 'soft', onClick: () => ctx.openHire() });
    this.el.append(
      h(
        'div',
        { class: 'ao-empty-card' },
        h('h2', null, t('empty.title')),
        h('p', null, t('empty.intro')),
        h(
          'ol',
          { class: 'ao-empty-steps' },
          h('li', null, t('empty.step1')),
          h(
            'li',
            null,
            h('span', null, t('empty.step2.before')),
            h('code', null, 'claude'),
            h('span', null, t('empty.step2.after')),
          ),
          h('li', null, t('empty.step3')),
        ),
        h('div', { class: 'ao-row-actions' }, this.hireBtn, this.demoBtn),
        h('p', { class: 'ao-note' }, t('empty.note')),
      ),
    );
  }

  private async enableDemo(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.ctx.setDemo(true);
    } catch (error) {
      this.ctx.notifyLocal('warn', describeError(error));
    } finally {
      this.busy = false;
      this.ctx.refresh();
    }
  }

  render(): void {
    const snapshot = this.ctx.snapshot;
    const empty =
      snapshot !== null &&
      !this.ctx.replay.engaged &&
      computeCounters(snapshot).agents === 0 &&
      snapshot.agents.every((agent) => agent.status === 'offline' || agent.status === 'done');
    this.el.hidden = !empty;
    if (!empty) return;
    const canDemo = this.ctx.isLocal && this.ctx.store.mode === 'live';
    setDisabled(this.hireBtn, !this.ctx.isLocal, localOnlyHint());
    this.demoBtn.disabled = !canDemo || this.busy;
    this.demoBtn.title = canDemo ? '' : localOnlyHint();
    toggleClass(this.el, 'is-narrow', this.ctx.ui.get().narrow);
  }
}
