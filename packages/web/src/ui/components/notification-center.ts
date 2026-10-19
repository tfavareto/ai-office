// Bell popover: notification history with filters, "Não perturbe" and clear.
import { h, setText, toggleClass } from '../dom';
import { formatAgo } from '../format';
import { icon, type IconName } from '../icons';
import { filterItems, unreadCount, type NotificationFilter, type NotificationItem } from '../model/notifications';
import type { AppContext } from '../context';
import { emptyNote } from '../widgets';
import { Popover } from './overlay';

const FILTERS: readonly { id: NotificationFilter; label: string }[] = [
  { id: 'all', label: 'Tudo' },
  { id: 'alerts', label: 'Precisa de você' },
  { id: 'messages', label: 'Mensagens' },
];

const LEVEL_ICON: Record<NotificationItem['level'], IconName> = { info: 'info', success: 'check', warn: 'alert', alert: 'bell' };

export class NotificationCenter extends Popover {
  private filter: NotificationFilter = 'all';
  private readonly list = h('ol', { class: 'ao-notif-list' });
  private readonly tabs = new Map<NotificationFilter, HTMLButtonElement>();
  private readonly dndBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private signature = '';

  constructor(ctx: AppContext) {
    super(ctx, 'notifications', 'Notificações', 'ao-popover--notifications');
    this.dndBtn = h('button', { type: 'button', class: 'ao-switch-row', role: 'switch', 'aria-checked': 'false', onclick: () => this.toggleDnd() }, h('span', { class: 'ao-switch' }, h('span', { class: 'ao-switch-knob' })), h('span', null, 'Não perturbe'));
    this.dndBtn.title = 'Com "Não perturbe" só os alertas viram aviso, som e notificação do navegador.';
    this.clearBtn = h('button', { type: 'button', class: 'ao-btn ao-btn--ghost ao-btn--small', onclick: () => ctx.notifications.clear() }, icon('trash', 14), h('span', null, 'Limpar'));
    const tablist = h('div', { class: 'ao-segmented', role: 'tablist', 'aria-label': 'Filtro' });
    for (const f of FILTERS) {
      const btn = h('button', { type: 'button', role: 'tab', class: 'ao-segmented-item', onclick: () => this.setFilter(f.id) }, f.label);
      this.tabs.set(f.id, btn);
      tablist.appendChild(btn);
    }
    this.el.append(h('header', { class: 'ao-popover-head' }, h('strong', null, 'Notificações'), this.clearBtn), h('div', { class: 'ao-popover-sub' }, tablist), this.list, h('footer', { class: 'ao-popover-foot' }, this.dndBtn));
  }

  private setFilter(filter: NotificationFilter): void {
    this.filter = filter;
    this.signature = '';
    this.ctx.refresh();
  }

  private toggleDnd(): void {
    const next = !this.ctx.notifications.get().dnd;
    this.ctx.notifications.setDnd(next);
    this.ctx.prefs.set({ dnd: next });
  }

  protected onOpen(): void {
    this.signature = '';
    this.ctx.notifications.markAllRead();
  }

  protected update(): void {
    const state = this.ctx.notifications.get();
    if (unreadCount(state) > 0) this.ctx.notifications.markAllRead();
    this.dndBtn.setAttribute('aria-checked', String(state.dnd));
    toggleClass(this.dndBtn, 'is-on', state.dnd);
    this.clearBtn.disabled = state.items.length === 0;
    for (const [id, btn] of this.tabs) {
      btn.setAttribute('aria-selected', String(id === this.filter));
      toggleClass(btn, 'is-on', id === this.filter);
    }
    const now = this.ctx.now();
    const items = filterItems(state.items, this.filter);
    const signature = `${this.filter}|${Math.floor(now / 30_000)}|${items.map((i) => `${i.id}:${i.count}:${i.text}:${i.at}`).join('|')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.replaceChildren(...(items.length === 0 ? [h('li', null, emptyNote(this.emptyText()))] : items.map((item) => this.item(item, now))));
  }

  private emptyText(): string {
    if (this.filter === 'alerts') return 'Nenhum agente precisou de você ainda.';
    if (this.filter === 'messages') return 'Nenhuma mensagem entregue ainda.';
    return 'Nenhuma notificação por enquanto.';
  }

  private item(item: NotificationItem, now: number): HTMLElement {
    const body = h('span', { class: 'ao-notif-body' });
    setText(body, item.text);
    const agentId = item.agentId;
    const clickable = agentId !== undefined && this.ctx.agent(agentId) !== undefined;
    const row = h(
      clickable ? 'button' : 'div',
      { class: `ao-notif ao-notif--${item.level} ${clickable ? 'is-link' : ''}`.trim(), type: clickable ? 'button' : null },
      h('span', { class: 'ao-notif-icon' }, icon(LEVEL_ICON[item.level], 16)),
      body,
      item.count > 1 ? h('span', { class: 'ao-toast-count' }, `×${item.count}`) : null,
      h('span', { class: 'ao-notif-time' }, formatAgo(now - item.at)),
    );
    if (clickable && agentId) {
      row.addEventListener('click', () => {
        this.ctx.closePopover();
        this.ctx.selectAgent(agentId, { focus: true });
      });
    }
    return h('li', null, row);
  }
}
