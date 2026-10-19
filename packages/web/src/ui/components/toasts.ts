// Toasts: bottom-right stack. Alerts persist until resolved; repeated notices collapse with a counter.
import type { AppContext, Component } from '../context';
import { KeyedList, h, setText, type KeyedEntry } from '../dom';
import { icon, type IconName } from '../icons';
import type { Toast } from '../model/toasts';

const LEVEL_ICON: Record<Toast['level'], IconName> = { info: 'info', success: 'check', warn: 'alert', alert: 'bell' };

export class Toasts implements Component {
  readonly el = h('div', { class: 'ao-toasts', role: 'region', 'aria-label': 'Avisos' });
  private readonly list: KeyedList<Toast>;
  private signature = '';

  constructor(private readonly ctx: AppContext) {
    this.list = new KeyedList(this.el, (toast) => toast.id, (toast) => this.create(toast));
  }

  render(): void {
    const toasts = this.ctx.toasts.get();
    const signature = toasts.map((t) => `${t.id}:${t.count}:${t.text}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.list.sync(toasts);
  }

  private create(initial: Toast): KeyedEntry<Toast> {
    const iconSlot = h('span', { class: 'ao-toast-icon' });
    const text = h('span', { class: 'ao-toast-text' });
    const count = h('span', { class: 'ao-toast-count', hidden: true });
    const actions = h('div', { class: 'ao-toast-actions' });
    const close = h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': 'Dispensar aviso', title: 'Dispensar' }, icon('x', 14));
    const el = h('div', { class: 'ao-toast', role: initial.level === 'alert' ? 'alert' : 'status' }, iconSlot, h('div', { class: 'ao-toast-body' }, h('div', { class: 'ao-toast-line' }, text, count), actions), close);
    let current = initial;
    close.addEventListener('click', () => this.ctx.toasts.dismiss(current.id));
    return {
      el,
      update: (toast) => {
        current = toast;
        el.className = `ao-toast ao-toast--${toast.level}`;
        iconSlot.replaceChildren(icon(LEVEL_ICON[toast.level], 18));
        setText(text, toast.text);
        count.hidden = toast.count < 2;
        setText(count, `×${toast.count}`);
        actions.replaceChildren();
        const agentId = toast.agentId;
        if (agentId && this.ctx.agent(agentId)) {
          const label = toast.level === 'alert' ? 'Responder' : 'Ver';
          actions.appendChild(
            h('button', { type: 'button', class: 'ao-btn ao-btn--soft ao-btn--small', onclick: () => this.answer(toast) }, label),
          );
        }
      },
    };
  }

  private answer(toast: Toast): void {
    if (!toast.agentId) return;
    this.ctx.selectAgent(toast.agentId, { focus: true, tab: 'summary' });
    if (toast.level !== 'alert') this.ctx.toasts.dismiss(toast.id);
  }
}
