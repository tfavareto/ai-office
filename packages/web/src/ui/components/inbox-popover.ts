// The inbox: one prioritized list of everything that waits on the user, with keyboard triage and bulk actions.
// It floats in the free area under the top bar (not over the sidebar or the drawer), and stays open while the user
// works in the rest of the page; Esc or the counter closes it.
import { t } from '../../i18n';
import type { AppContext } from '../context';
import { KeyedList, h, isEditable, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { InboxActions } from '../inbox-actions';
import type { InboxItem, InboxKind } from '../model/inbox';
import { groupOf } from '../model/inbox-bulk';
import { resolveInboxKey, type InboxKeyAction } from '../model/inbox-keys';
import { closeButton, Popover } from './overlay';
import { InboxConfirm } from './inbox-confirm';
import { createInboxEntry, rowKey, type InboxRowModel } from './inbox-row';
import { InboxToolbar } from './inbox-toolbar';

/** Panels with their own keyboard handling: the inbox shortcuts stay out of them. */
const OTHER_PANELS = '.ao-topbar, .ao-sidebar, .ao-drawer, .ao-terminal, .ao-feed, .ao-dialog-scrim, .ao-popover:not(.ao-popover--inbox)';

export class InboxPopover extends Popover {
  private readonly actions: InboxActions;
  private readonly toolbar: InboxToolbar;
  private readonly confirm: InboxConfirm;
  private readonly count = h('span', { class: 'ao-inbox-count' });
  private readonly scroller = h('div', { class: 'ao-inbox-list', tabindex: '0', role: 'group', 'aria-label': t('inbox.list') });
  private readonly listEl = h('ul', { class: 'ao-inbox-items' });
  private readonly empty: HTMLElement;
  private readonly rows: KeyedList<InboxRowModel>;
  private readonly onDocumentKey = (event: KeyboardEvent): void => this.handleKey(event);
  private lastCursor: string | null = null;
  private hadItems = false;

  constructor(ctx: AppContext) {
    super(ctx, 'inbox', t('inbox.title'), 'ao-popover--inbox');
    this.actions = new InboxActions(ctx);
    this.toolbar = new InboxToolbar(ctx, this.actions);
    this.confirm = new InboxConfirm(ctx, this.actions);
    this.rows = new KeyedList(this.listEl, rowKey, (row) => createInboxEntry(ctx, this.actions, row));
    this.empty = h(
      'div',
      { class: 'ao-inbox-empty', hidden: true },
      h('span', { class: 'ao-inbox-empty-art', 'aria-hidden': 'true' }, icon('coffee', 34)),
      h('strong', null, t('inbox.empty.title')),
      h('p', { class: 'ao-note' }, t('inbox.empty.text')),
    );
    this.scroller.append(this.listEl);
    this.el.append(
      h('header', { class: 'ao-popover-head ao-inbox-titlebar' }, icon('bell', 18), h('strong', null, t('inbox.title')), this.count, closeButton(t('inbox.close'), () => ctx.closePopover())),
      this.toolbar.el,
      this.empty,
      this.scroller,
      this.confirm.el,
      h('footer', { class: 'ao-popover-foot ao-inbox-foot' }, h('span', { class: 'ao-inbox-hint' }, t('inbox.hint'))),
    );
    this.el.addEventListener('keydown', (event) => this.cancelOnEscape(event));
    document.addEventListener('keydown', this.onDocumentKey);
  }

  dispose(): void {
    document.removeEventListener('keydown', this.onDocumentKey);
  }

  override focusTarget(): HTMLElement {
    return this.scroller;
  }

  protected onOpen(): void {
    const { cursor } = this.ctx.inbox.get();
    this.ctx.inbox.set({ denying: null, confirm: null });
    if (cursor === null) this.ctx.inbox.moveCursor(1);
    this.hadItems = this.ctx.inbox.view().items.length > 0;
  }

  protected update(): void {
    const view = this.ctx.inbox.view();
    const ui = this.ctx.inbox.get();
    const hadFocus = this.el.contains(document.activeElement);
    setText(this.count, t('inbox.count', { n: view.items.length }));
    const isEmpty = view.items.length === 0;
    this.empty.hidden = !isEmpty;
    this.scroller.hidden = isEmpty;
    this.rows.sync(this.buildRows(view.items));
    this.toolbar.render();
    this.confirm.render();
    toggleClass(this.el, 'has-confirm', ui.confirm !== null);
    this.keepFocus(hadFocus);
    this.followCursor(ui.cursor);
    this.announceWhenCleared(isEmpty);
  }

  private buildRows(items: readonly InboxItem[]): InboxRowModel[] {
    const ui = this.ctx.inbox.get();
    const groups = this.ctx.inbox.groups();
    const counts = new Map<InboxKind, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    const rows: InboxRowModel[] = [];
    let last: InboxKind | null = null;
    for (const item of items) {
      if (item.kind !== last) {
        last = item.kind;
        rows.push({ type: 'heading', kind: item.kind, count: counts.get(item.kind) ?? 0 });
      }
      rows.push({
        type: 'item',
        item,
        ui: {
          cursor: ui.cursor === item.id,
          selected: ui.selection.ids.includes(item.id),
          busy: ui.busy.includes(item.id),
          denying: ui.denying === item.id,
          groupSize: groupOf(groups, item.id)?.items.length ?? 0,
        },
      });
    }
    return rows;
  }

  /** When the focused control disappeared (its item was answered), focus returns to the list. */
  private keepFocus(hadFocus: boolean): void {
    if (hadFocus && !this.el.contains(document.activeElement) && this.ctx.ui.get().popover === 'inbox') this.scroller.focus({ preventScroll: true });
  }

  private followCursor(cursor: string | null): void {
    if (cursor === this.lastCursor) return;
    this.lastCursor = cursor;
    if (cursor !== null) this.rowElement(cursor)?.scrollIntoView({ block: 'nearest' });
  }

  private announceWhenCleared(isEmpty: boolean): void {
    if (isEmpty && this.hadItems) this.ctx.announce(t('announce.inbox.cleared'));
    this.hadItems = !isEmpty;
  }

  private rowElement(id: string): HTMLElement | null {
    return this.listEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  }

  // --- keyboard -----------------------------------------------------------------------------------------------------

  /** Esc backs out of the innermost thing (confirmation, deny box) before it closes the inbox. */
  private cancelOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    const ui = this.ctx.inbox.get();
    if (ui.confirm === null && ui.denying === null) return;
    event.stopPropagation();
    this.ctx.inbox.set({ confirm: null, denying: null });
    this.scroller.focus({ preventScroll: true });
  }

  private ownsKeyboard(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return true;
    return this.el.contains(target) || target.closest(OTHER_PANELS) === null;
  }

  private handleKey(event: KeyboardEvent): void {
    const ui = this.ctx.ui.get();
    if (ui.popover !== 'inbox' || ui.dialog !== null || event.defaultPrevented || this.ctx.inbox.get().confirm !== null) return;
    if (!this.ownsKeyboard(event.target)) return;
    const onControl = event.target instanceof Element && event.target.closest('button, a[href], summary') !== null;
    const action = resolveInboxKey(event, { editing: isEditable(event.target), onControl });
    if (action === null) return;
    event.preventDefault();
    this.run(action);
    this.ctx.refresh();
  }

  private cursorItem(): InboxItem | undefined {
    const { cursor } = this.ctx.inbox.get();
    return this.ctx.inbox.view().items.find((item) => item.id === cursor);
  }

  private run(action: InboxKeyAction): void {
    const inbox = this.ctx.inbox;
    const item = this.cursorItem();
    switch (action) {
      case 'next':
        inbox.moveCursor(1);
        return;
      case 'previous':
        inbox.moveCursor(-1);
        return;
      case 'toggle':
        if (item) inbox.toggleSelected(item.id);
        return;
      case 'open':
        if (item) this.actions.openAgent(item);
        return;
      case 'seen':
        this.markSeenFromKeyboard(item);
        return;
      case 'approve':
        this.approveFromKeyboard(item);
        return;
      case 'remember':
        if (item?.kind === 'permission') void this.actions.approveAndRemember(item);
        return;
      case 'deny':
        this.denyFromKeyboard(item);
        return;
    }
  }

  private markSeenFromKeyboard(item: InboxItem | undefined): void {
    const selected = this.toolbar.selectedItems();
    this.actions.markSeen(selected.length > 0 ? selected : item ? [item] : []);
    this.ctx.inbox.clearSelection();
  }

  private approveFromKeyboard(item: InboxItem | undefined): void {
    if (this.ctx.inbox.get().selection.ids.length > 0) {
      this.toolbar.openPlan('approve');
      return;
    }
    if (item?.kind !== 'permission') return;
    if (item.risk !== undefined) {
      // A risky request is approved with the mouse or an explicit focus on its button, never with a single key.
      this.ctx.announce(t('inbox.risk.useButton'));
      this.rowElement(item.id)?.querySelector<HTMLElement>('[data-role="approve"]')?.focus();
      return;
    }
    void this.actions.approve(item);
  }

  private denyFromKeyboard(item: InboxItem | undefined): void {
    if (this.ctx.inbox.get().selection.ids.length > 0) {
      this.toolbar.openPlan('deny');
      return;
    }
    if (item?.kind === 'permission' && this.actions.canAnswer(item)) this.ctx.inbox.set({ denying: item.id });
  }
}
