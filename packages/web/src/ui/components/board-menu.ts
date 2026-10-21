// "Move to…" menu of a board card: columns and agents it can go to. Opened by the card's button or the M key.
import { t } from '../../i18n';
import { h } from '../dom';

export interface MenuOption {
  label: string;
  group: 'column' | 'agent';
  run(): void;
}

const MENU_GAP = 4;

export class MoveMenu {
  readonly el = h('div', { class: 'ao-board-menu', role: 'menu', hidden: true });
  private returnTo: HTMLElement | null = null;

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /** Shows the options under `anchor`, positioned inside `container` (the dialog panel). */
  open(anchor: HTMLElement, container: HTMLElement, title: string, options: readonly MenuOption[]): void {
    this.returnTo = anchor;
    const items = options.map((option) => {
      const item = h(
        'button',
        { type: 'button', role: 'menuitem', class: `ao-board-menu-item is-${option.group}` },
        option.label,
      );
      item.addEventListener('click', () => {
        this.close(false);
        option.run();
      });
      return item;
    });
    this.el.replaceChildren(
      h('div', { class: 'ao-board-menu-title' }, title),
      ...(items.length > 0 ? items : [h('p', { class: 'ao-note' }, t('board.menu.none'))]),
    );
    this.el.hidden = false;
    const box = container.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const width = this.el.offsetWidth;
    const left = Math.max(8, Math.min(rect.left - box.left, box.width - width - 8));
    const below = rect.bottom - box.top + MENU_GAP;
    const top =
      below + this.el.offsetHeight > box.height - 8
        ? Math.max(8, rect.top - box.top - this.el.offsetHeight - MENU_GAP)
        : below;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    items[0]?.focus({ preventScroll: true });
  }

  close(restoreFocus = true): void {
    if (!this.isOpen) return;
    this.el.hidden = true;
    if (restoreFocus) this.returnTo?.focus({ preventScroll: true });
    this.returnTo = null;
  }

  /** Arrow keys move between the options. */
  onKeyDown(event: KeyboardEvent): void {
    if (!this.isOpen || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    const items = Array.from(this.el.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus({ preventScroll: true });
  }
}
