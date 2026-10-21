// Confirmation step of a bulk action: lists what will happen and what is left out, before anything is sent.
import { t, type TextKey } from '../../i18n';
import type { AppContext, Component } from '../context';
import { permissionSummary } from '../display';
import { h, setText } from '../dom';
import { truncate } from '../format';
import { icon } from '../icons';
import type { InboxActions } from '../inbox-actions';
import type { BulkPlan } from '../model/inbox-bulk';
import { button, setDisabled } from '../widgets';

const LISTED_ITEMS = 5;
const SUMMARY_CHARS = 90;

export class InboxConfirm implements Component {
  readonly el = h('section', {
    class: 'ao-inbox-confirm',
    role: 'alertdialog',
    'aria-labelledby': 'ao-inbox-confirm-title',
    hidden: true,
  });
  private readonly title = h('strong', { id: 'ao-inbox-confirm-title' });
  private readonly note = h('p', { class: 'ao-note' });
  private readonly list = h('ul', { class: 'ao-inbox-confirm-list' });
  private readonly skipped = h('div', { class: 'ao-inbox-confirm-skipped' });
  private readonly reason = h('textarea', {
    class: 'ao-textarea ao-textarea--small',
    rows: 2,
    placeholder: t('permission.deny.placeholder'),
    'aria-label': t('permission.deny.reason'),
  });
  private readonly run: HTMLButtonElement;
  private plan: BulkPlan | null = null;
  private running = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly actions: InboxActions,
  ) {
    this.run = button({
      label: t('inbox.confirm.run'),
      icon: 'check',
      variant: 'primary',
      onClick: () => void this.confirm(),
    });
    this.el.append(
      this.title,
      this.note,
      this.list,
      this.skipped,
      this.reason,
      h(
        'div',
        { class: 'ao-row-actions' },
        this.run,
        button({ label: t('common.cancel'), variant: 'ghost', onClick: () => this.cancel() }),
      ),
    );
    this.reason.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        void this.confirm();
      }
    });
  }

  private cancel(): void {
    this.ctx.inbox.set({ confirm: null });
  }

  private async confirm(): Promise<void> {
    const plan = this.plan;
    if (!plan || plan.include.length === 0 || this.running) return;
    this.running = true;
    this.run.disabled = true;
    await this.actions.runBulk(plan, plan.action === 'deny' ? this.reason.value : undefined);
    this.running = false;
  }

  render(): void {
    const plan = this.ctx.inbox.get().confirm;
    this.el.hidden = plan === null;
    if (plan === null) {
      this.plan = null;
      return;
    }
    if (plan !== this.plan) {
      this.plan = plan;
      this.running = false;
      this.reason.value = '';
      this.build(plan);
      queueMicrotask(() => this.run.focus({ preventScroll: false }));
    }
    setDisabled(this.run, this.running || plan.include.length === 0);
  }

  private build(plan: BulkPlan): void {
    const n = plan.include.length;
    setText(
      this.title,
      n === 0
        ? t('inbox.confirm.empty')
        : t(plan.action === 'approve' ? 'inbox.confirm.approve' : 'inbox.confirm.deny', { n }),
    );
    setText(
      this.note,
      n === 0 ? '' : t(plan.action === 'approve' ? 'inbox.confirm.noteApprove' : 'inbox.confirm.noteDeny'),
    );
    this.reason.hidden = plan.action !== 'deny' || n === 0;
    const rows = plan.include.slice(0, LISTED_ITEMS).map((item) => {
      const name = this.ctx.agent(item.agentId)?.name ?? '';
      return h(
        'li',
        null,
        h('strong', null, name),
        item.permission ? h('span', { class: 'ao-tool-chip' }, item.permission.toolName) : null,
        h(
          'span',
          { class: 'ao-inbox-confirm-text' },
          truncate(item.permission ? permissionSummary(item.permission) : '', SUMMARY_CHARS),
        ),
      );
    });
    if (n > LISTED_ITEMS)
      rows.push(h('li', { class: 'ao-inbox-confirm-more' }, t('inbox.confirm.more', { n: n - LISTED_ITEMS })));
    this.list.replaceChildren(...rows);
    this.skipped.hidden = plan.skipped.length === 0;
    this.skipped.replaceChildren(
      ...(plan.skipped.length === 0
        ? []
        : [
            h(
              'p',
              { class: 'ao-inbox-confirm-skip-title' },
              icon('alert', 14),
              t('inbox.confirm.skipped', { n: plan.skipped.length }),
            ),
            h(
              'ul',
              null,
              ...plan.skipped.map((skip) =>
                h(
                  'li',
                  null,
                  h('strong', null, this.ctx.agent(skip.item.agentId)?.name ?? ''),
                  h('span', null, t(`inbox.skip.${skip.reason}` satisfies TextKey)),
                ),
              ),
            ),
          ]),
    );
  }
}
