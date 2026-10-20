// Under the inbox title: "similar requests" shortcuts and the bulk bar for the current selection.
import { t } from '../../i18n';
import type { AppContext, Component } from '../context';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import type { InboxActions } from '../inbox-actions';
import type { InboxItem } from '../model/inbox';
import { planBulk, type SimilarGroup } from '../model/inbox-bulk';
import { button, iconButton, setDisabled } from '../widgets';

const MAX_GROUPS_SHOWN = 3;

export class InboxToolbar implements Component {
  readonly el = h('div', { class: 'ao-inbox-tools' });
  private readonly groups = h('div', { class: 'ao-inbox-groups', hidden: true });
  private readonly bar = h('div', { class: 'ao-inbox-bulk', hidden: true });
  private readonly selectAll = h('input', { type: 'checkbox', class: 'ao-inbox-check', 'aria-label': t('inbox.bulk.selectAll') });
  private readonly count = h('span', { class: 'ao-inbox-bulk-count' });
  private readonly approve: HTMLButtonElement;
  private readonly deny: HTMLButtonElement;
  private readonly seen: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private groupsSignature = '';

  constructor(
    private readonly ctx: AppContext,
    private readonly actions: InboxActions,
  ) {
    this.approve = button({ label: t('inbox.bulk.approve'), icon: 'check', variant: 'primary', className: 'ao-btn--small', onClick: () => this.openPlan('approve') });
    this.deny = button({ label: t('inbox.bulk.deny'), icon: 'x', variant: 'soft', className: 'ao-btn--small', onClick: () => this.openPlan('deny') });
    this.seen = button({ label: t('inbox.bulk.seen'), icon: 'follow', variant: 'ghost', className: 'ao-btn--small', onClick: () => this.markSeen() });
    this.clear = iconButton({ icon: 'x', label: t('inbox.bulk.clear'), className: 'ao-iconbtn--small', size: 14, onClick: () => ctx.inbox.clearSelection() });
    this.selectAll.addEventListener('change', () => (this.selectAll.checked ? ctx.inbox.selectAll() : ctx.inbox.clearSelection()));
    this.bar.append(
      h('label', { class: 'ao-inbox-selectall' }, this.selectAll, this.count),
      h('span', { class: 'ao-inbox-spacer' }),
      this.approve,
      this.deny,
      this.seen,
      this.clear,
    );
    this.el.append(this.groups, this.bar);
  }

  /** The selected items, in list order. */
  selectedItems(): InboxItem[] {
    const ids = new Set(this.ctx.inbox.get().selection.ids);
    return this.ctx.inbox.view().items.filter((item) => ids.has(item.id));
  }

  openPlan(action: 'approve' | 'deny', items: readonly InboxItem[] = this.selectedItems()): void {
    this.ctx.inbox.set({ confirm: planBulk(action, items), denying: null });
  }

  private markSeen(): void {
    this.actions.markSeen(this.selectedItems());
    this.ctx.inbox.clearSelection();
  }

  render(): void {
    this.renderGroups(this.ctx.inbox.groups());
    this.renderBar();
  }

  private renderGroups(groups: readonly SimilarGroup[]): void {
    const shown = groups.slice(0, MAX_GROUPS_SHOWN);
    this.groups.hidden = shown.length === 0;
    const signature = shown.map((group) => `${group.key}:${group.items.length}`).join('|');
    if (signature === this.groupsSignature) return;
    this.groupsSignature = signature;
    this.groups.replaceChildren(
      ...(shown.length === 0
        ? []
        : [
            h('div', { class: 'ao-inbox-groups-title' }, icon('layers', 14), t('inbox.similar.title')),
            ...shown.map((group) =>
              h(
                'div',
                { class: 'ao-inbox-group' },
                h('span', { class: 'ao-tool-chip' }, group.toolName),
                h('span', { class: 'ao-inbox-group-text', title: group.label }, t('inbox.similar.group', { label: group.label, n: group.items.length })),
                button({ label: t('inbox.similar.approve'), icon: 'check', variant: 'soft', className: 'ao-btn--small', onClick: () => this.openPlan('approve', group.items) }),
              ),
            ),
          ]),
    );
  }

  private renderBar(): void {
    const { selection } = this.ctx.inbox.get();
    const items = this.ctx.inbox.view().items;
    const selected = this.selectedItems();
    this.bar.hidden = items.length < 2;
    toggleClass(this.bar, 'has-selection', selection.ids.length > 0);
    setText(this.count, selection.ids.length > 0 ? t('inbox.bulk.selected', { n: selection.ids.length }) : t('inbox.bulk.selectAll'));
    this.selectAll.checked = items.length > 0 && selection.ids.length === items.length;
    this.selectAll.indeterminate = selection.ids.length > 0 && selection.ids.length < items.length;
    const hasSelection = selection.ids.length > 0;
    const answerable = selected.some((item) => item.kind === 'permission');
    const reason = this.ctx.isLocal ? undefined : t('permission.localOnly');
    this.approve.hidden = this.deny.hidden = !hasSelection || !answerable;
    this.seen.hidden = !hasSelection || selected.every((item) => item.kind === 'permission');
    this.clear.hidden = !hasSelection;
    setDisabled(this.approve, !this.ctx.isLocal, reason);
    setDisabled(this.deny, !this.ctx.isLocal, reason);
  }
}
