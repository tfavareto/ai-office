// One row of the inbox list: avatar, who and where, what is waiting, and the actions that fit its kind.
import type { Agent } from '@ai-office/shared';
import { t, type TextKey } from '../../i18n';
import type { AppContext } from '../context';
import { activityDetail, activityText, localized, permissionSuggestion, permissionSummary } from '../display';
import { h, setAttr, setText, toggleClass, type KeyedEntry } from '../dom';
import { truncate } from '../format';
import { icon } from '../icons';
import type { InboxActions } from '../inbox-actions';
import { isExpiringSoon, type InboxItem, type InboxKind } from '../model/inbox';
import { roomColor } from '../model/rooms';
import { button, createAvatar, liveText, setDisabled, setLive } from '../widgets';

const AVATAR_SIZE = 34;
const SUMMARY_CHARS = 220;

/** The list mixes group headings and item rows. */
export type InboxRowModel =
  | { type: 'heading'; kind: InboxKind; count: number }
  | { type: 'item'; item: InboxItem; ui: InboxRowUi };

export interface InboxRowUi {
  cursor: boolean;
  selected: boolean;
  busy: boolean;
  denying: boolean;
  /** Size of the "looks alike" group the item belongs to (0 or 1: none). */
  groupSize: number;
}

export function rowKey(row: InboxRowModel): string {
  return row.type === 'heading' ? `heading:${row.kind}` : row.item.id;
}

export function createInboxEntry(ctx: AppContext, actions: InboxActions, row: InboxRowModel): KeyedEntry<InboxRowModel> {
  return row.type === 'heading' ? createHeading() : new InboxRow(ctx, actions, row.item).entry();
}

function createHeading(): KeyedEntry<InboxRowModel> {
  const label = h('span', { class: 'ao-inbox-heading-label' });
  const count = h('span', { class: 'ao-inbox-heading-count' });
  const el = h('li', { class: 'ao-inbox-heading', role: 'presentation' }, label, count);
  return {
    el,
    update(row) {
      if (row.type !== 'heading') return;
      setText(label, t(`inbox.kind.${row.kind}` satisfies TextKey));
      setText(count, String(row.count));
    },
  };
}

class InboxRow {
  private readonly el = h('li', { class: 'ao-inbox-row' });
  private readonly checkbox = h('input', { type: 'checkbox', class: 'ao-inbox-check' });
  private readonly avatar = createAvatar(AVATAR_SIZE);
  private readonly name = h('strong', { class: 'ao-inbox-name' });
  private readonly room = h('span', { class: 'ao-inbox-room' });
  private readonly swatch = h('i', { class: 'ao-inbox-swatch', 'aria-hidden': 'true' });
  private readonly roomName = h('span');
  private readonly time = liveText('ago', 0, 'ao-inbox-time');
  private readonly tool = h('span', { class: 'ao-tool-chip' });
  private readonly text = h('p', { class: 'ao-inbox-text' });
  private readonly risk = h('span', { class: 'ao-inbox-risk' }, icon('alert', 12));
  private readonly riskText = h('span');
  private readonly similar = h('button', { type: 'button', class: 'ao-inbox-similar' });
  private readonly expires = h('span', { class: 'ao-inbox-expires' });
  private readonly expiresIn = liveText('until', 0);
  private readonly note = h('p', { class: 'ao-inbox-note' });
  private readonly actionsBox = h('div', { class: 'ao-inbox-actions' });
  private readonly denyBox = h('div', { class: 'ao-inbox-deny', hidden: true });
  private readonly reason = h('textarea', { class: 'ao-textarea ao-textarea--small', rows: 2, placeholder: t('permission.deny.placeholder'), 'aria-label': t('permission.deny.reason') });
  private readonly permissionButtons: { approve: HTMLButtonElement; remember: HTMLButtonElement; deny: HTMLButtonElement; terminal: HTMLButtonElement } | null;
  private item: InboxItem;
  private wasDenying = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly actions: InboxActions,
    initial: InboxItem,
  ) {
    this.item = initial;
    this.el.dataset.id = initial.id;
    this.room.append(this.swatch, this.roomName);
    this.risk.append(this.riskText);
    this.expires.append(t('permission.expiresIn'), this.expiresIn);
    this.permissionButtons = initial.kind === 'permission' ? this.buildPermissionActions() : null;
    if (!this.permissionButtons) this.buildOtherActions();
    this.buildDenyBox();
    this.wire();
    this.el.append(
      this.checkbox,
      h('span', { class: 'ao-inbox-avatar' }, this.avatar.el),
      h(
        'div',
        { class: 'ao-inbox-main' },
        h('div', { class: 'ao-inbox-head' }, this.name, this.room, h('span', { class: 'ao-inbox-spacer' }), this.time),
        h('div', { class: 'ao-inbox-body' }, this.tool, this.text),
        h('div', { class: 'ao-inbox-flags' }, this.risk, this.similar, this.expires),
        this.note,
        this.actionsBox,
        this.denyBox,
      ),
    );
  }

  entry(): KeyedEntry<InboxRowModel> {
    return {
      el: this.el,
      update: (row) => {
        if (row.type === 'item') this.update(row.item, row.ui);
      },
    };
  }

  // --- construction -------------------------------------------------------------------------------------------------

  private buildPermissionActions(): NonNullable<InboxRow['permissionButtons']> {
    const approve = button({ label: t('permission.allow'), icon: 'check', variant: 'primary', className: 'ao-btn--small', onClick: () => void this.actions.approve(this.item) });
    const remember = button({ label: t('permission.remember'), icon: 'shield', variant: 'soft', className: 'ao-btn--small', onClick: () => void this.actions.approveAndRemember(this.item) });
    const deny = button({ label: t('permission.deny'), icon: 'x', variant: 'soft', className: 'ao-btn--small', onClick: () => this.ctx.inbox.set({ denying: this.ctx.inbox.get().denying === this.item.id ? null : this.item.id }) });
    const terminal = button({ label: t('permission.terminal'), icon: 'terminal', variant: 'ghost', className: 'ao-btn--small', title: t('permission.terminal.hint'), onClick: () => void this.actions.answerInTerminal(this.item) });
    approve.dataset.role = 'approve';
    this.actionsBox.append(approve, remember, deny, terminal);
    return { approve, remember, deny, terminal };
  }

  private buildOtherActions(): void {
    this.actionsBox.append(
      button({ label: t('inbox.action.open'), icon: 'target', variant: 'primary', className: 'ao-btn--small', onClick: () => this.actions.openAgent(this.item) }),
      button({ label: t('inbox.action.terminal'), icon: 'terminal', variant: 'ghost', className: 'ao-btn--small', onClick: () => this.actions.openTerminal(this.item) }),
      button({ label: t('inbox.action.seen'), icon: 'check', variant: 'ghost', className: 'ao-btn--small', onClick: () => this.actions.markSeen([this.item]) }),
    );
  }

  private buildDenyBox(): void {
    const confirm = (): void => {
      const reason = this.reason.value;
      this.ctx.inbox.set({ denying: null });
      void this.actions.deny(this.item, reason);
    };
    const cancel = (): void => this.ctx.inbox.set({ denying: null });
    this.reason.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        cancel();
      } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        confirm();
      }
    });
    this.denyBox.append(
      this.reason,
      h('div', { class: 'ao-row-actions' }, button({ label: t('permission.deny.confirm'), variant: 'danger', className: 'ao-btn--small', onClick: confirm }), button({ label: t('common.cancel'), variant: 'ghost', className: 'ao-btn--small', onClick: cancel })),
    );
  }

  private wire(): void {
    this.checkbox.addEventListener('click', (event) => {
      if (event.shiftKey) this.ctx.inbox.selectRangeTo(this.item.id);
      else this.ctx.inbox.toggleSelected(this.item.id);
    });
    this.similar.addEventListener('click', () => this.selectGroup());
    this.el.addEventListener('click', (event) => this.onRowClick(event));
    this.el.addEventListener('dblclick', (event) => {
      if (event.target instanceof Element && !event.target.closest('button, input, textarea')) this.actions.openAgent(this.item);
    });
  }

  private onRowClick(event: MouseEvent): void {
    if (!(event.target instanceof Element) || event.target.closest('button, input, textarea')) return;
    if (event.shiftKey) this.ctx.inbox.selectRangeTo(this.item.id);
    else this.ctx.inbox.setCursor(this.item.id);
  }

  private selectGroup(): void {
    const key = this.item.similarKey;
    if (key === undefined) return;
    const ids = this.ctx.inbox.view().items.filter((candidate) => candidate.similarKey === key && candidate.risk === undefined && candidate.expired !== true).map((candidate) => candidate.id);
    const current = this.ctx.inbox.get().selection;
    this.ctx.inbox.set({ selection: { ids: Array.from(new Set([...current.ids, ...ids])), anchor: this.item.id } });
  }

  // --- rendering ----------------------------------------------------------------------------------------------------

  update(item: InboxItem, ui: InboxRowUi): void {
    this.item = item;
    const agent = this.ctx.agent(item.agentId);
    if (agent) this.renderWho(agent, item);
    setLive(this.time, 'ago', item.at);
    this.renderBody(item, agent);
    this.renderFlags(item, ui);
    this.renderState(item, ui);
    if (item.kind === 'permission') this.renderPermissionButtons(item, ui);
    this.renderDeny(ui);
  }

  private renderWho(agent: Agent, item: InboxItem): void {
    this.avatar.update(agent, this.ctx.world.portrait(agent.id, AVATAR_SIZE * 2));
    setText(this.name, agent.name);
    const project = this.ctx.project(item.projectId);
    setText(this.roomName, project?.name ?? '');
    this.room.hidden = project === undefined;
    const color = project ? roomColor(project.seed) : 'transparent';
    this.el.style.setProperty('--room', color);
    this.swatch.style.background = color;
  }

  private renderBody(item: InboxItem, agent: Agent | undefined): void {
    const text = this.bodyText(item, agent);
    this.tool.hidden = item.kind !== 'permission';
    if (item.permission) setText(this.tool, item.permission.toolName);
    setText(this.text, truncate(text, SUMMARY_CHARS));
    setAttr(this.text, 'title', text.length > SUMMARY_CHARS ? text : null);
    const note = this.noteText(item);
    this.note.hidden = note === '';
    setText(this.note, note);
    this.checkbox.setAttribute('aria-label', t('inbox.row.select', { name: agent?.name ?? '', text: truncate(text, 80) }));
  }

  private bodyText(item: InboxItem, agent: Agent | undefined): string {
    switch (item.kind) {
      case 'permission':
        return item.permission ? permissionSummary(item.permission) : '';
      case 'attention':
        return item.waitingText !== undefined ? localized(item.waitingMsg, item.waitingText) : t('waiting.default');
      case 'error':
        return item.failure ? [activityText(item.failure), activityDetail(item.failure)].filter(Boolean).join(' · ') : t('inbox.row.errorNote');
      case 'finished':
        return agent?.activity ? `${agent.activity.icon} ${activityText(agent.activity)}` : t('inbox.row.finished');
    }
  }

  private noteText(item: InboxItem): string {
    if (item.kind === 'attention') return t('inbox.row.terminalNote');
    if (item.kind === 'error') return t('inbox.row.errorNote');
    if (item.kind === 'finished') return t('inbox.row.finished');
    return item.expired === true ? t('inbox.row.expired') : '';
  }

  private renderFlags(item: InboxItem, ui: InboxRowUi): void {
    const risky = item.risk !== undefined;
    this.risk.hidden = !risky;
    if (item.risk) {
      setText(this.riskText, `${t('inbox.risk')}: ${t(`inbox.risk.${item.risk}` satisfies TextKey)}`);
      setAttr(this.risk, 'title', t(`inbox.risk.${item.risk}` satisfies TextKey));
    }
    this.similar.hidden = ui.groupSize < 2;
    if (ui.groupSize >= 2) {
      setText(this.similar, t('inbox.similar.chip', { n: ui.groupSize }));
      setAttr(this.similar, 'title', t('inbox.similar.chipTitle', { n: ui.groupSize }));
    }
    const permission = item.kind === 'permission' ? item.permission : undefined;
    this.expires.hidden = permission === undefined || item.expired === true;
    if (permission) {
      setLive(this.expiresIn, 'until', permission.expiresAt);
      toggleClass(this.expires, 'is-soon', isExpiringSoon(permission, this.ctx.now()));
    }
  }

  private renderState(item: InboxItem, ui: InboxRowUi): void {
    toggleClass(this.el, `ao-inbox-row--${item.kind}`, true);
    toggleClass(this.el, 'is-cursor', ui.cursor);
    toggleClass(this.el, 'is-selected', ui.selected);
    toggleClass(this.el, 'is-busy', ui.busy);
    toggleClass(this.el, 'is-risky', item.risk !== undefined);
    toggleClass(this.el, 'is-expired', item.expired === true);
    if (this.checkbox.checked !== ui.selected) this.checkbox.checked = ui.selected;
    if (ui.cursor) this.el.setAttribute('aria-current', 'true');
    else this.el.removeAttribute('aria-current');
  }

  private renderPermissionButtons(item: InboxItem, ui: InboxRowUi): void {
    const buttons = this.permissionButtons;
    if (!buttons || !item.permission) return;
    const reason = this.ctx.isLocal ? undefined : t('permission.localOnly');
    const off = ui.busy || item.expired === true || !this.ctx.isLocal;
    setDisabled(buttons.approve, off, reason);
    setDisabled(buttons.deny, off, reason);
    setDisabled(buttons.terminal, off, reason);
    const rememberable = this.actions.rememberable(item);
    let rememberReason = reason;
    if (rememberReason === undefined && !rememberable) rememberReason = item.risk !== undefined ? t('inbox.remember.risky') : t('inbox.remember.none');
    buttons.remember.dataset.baseTitle = rememberable ? t('permission.remember.title', { rule: permissionSuggestion(item.permission, 0) }) : '';
    setDisabled(buttons.remember, off || !rememberable, rememberReason);
  }

  private renderDeny(ui: InboxRowUi): void {
    this.denyBox.hidden = !ui.denying;
    if (ui.denying && !this.wasDenying) {
      this.reason.value = '';
      queueMicrotask(() => this.reason.focus({ preventScroll: false }));
    }
    this.wasDenying = ui.denying;
  }
}
