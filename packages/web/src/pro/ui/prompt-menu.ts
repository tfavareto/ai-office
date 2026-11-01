// The list that opens above the Pro view's prompt while typing `@` or `$`: arrows move, Enter or Tab picks, Esc closes.
// The prompt keeps the keyboard; this only draws the rows and remembers which one is current.
import { h, toggleClass } from '../../ui/dom';
import { icon } from '../../ui/icons';

export interface MenuRow {
  id: string;
  title: string;
  /** Shown instead of being picked: a row that only explains. */
  note?: boolean;
  /** Label of the row's remove button, for rows that can be removed. */
  removeLabel?: string;
}

export interface MenuHandlers {
  pick(id: string): void;
  remove(id: string): void;
}

export class PromptMenu {
  readonly el = h('ul', { class: 'ao-pro-menu', role: 'listbox', hidden: true });
  private rows: readonly MenuRow[] = [];
  private cursor = 0;

  constructor(private readonly handlers: MenuHandlers) {}

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  show(rows: readonly MenuRow[]): void {
    this.rows = rows;
    this.cursor = Math.min(this.cursor, Math.max(rows.length - 1, 0));
    this.el.hidden = rows.length === 0;
    this.el.replaceChildren(...rows.map((row, index) => this.rowElement(row, index)));
    this.sync();
  }

  hide(): void {
    this.el.hidden = true;
    this.rows = [];
    this.cursor = 0;
  }

  move(step: 1 | -1): void {
    const count = this.rows.length;
    if (count === 0) return;
    this.cursor = (this.cursor + step + count) % count;
    this.sync();
  }

  /** Picks the current row; false when there is nothing to pick (only an explanation). */
  pickCurrent(): boolean {
    const row = this.rows[this.cursor];
    if (row === undefined || row.note === true) return false;
    this.handlers.pick(row.id);
    return true;
  }

  private rowElement(row: MenuRow, index: number): HTMLElement {
    const remove =
      row.removeLabel === undefined
        ? ''
        : h(
            'button',
            {
              type: 'button',
              class: 'ao-pro-menu-remove',
              title: row.removeLabel,
              'aria-label': row.removeLabel,
              onclick: (event: Event) => {
                event.stopPropagation();
                this.handlers.remove(row.id);
              },
            },
            icon('x', 12),
          );
    return h(
      'li',
      {
        class: `ao-pro-menu-row${row.note === true ? ' is-note' : ''}`,
        role: 'option',
        'aria-selected': 'false',
        // The press must not take the keyboard away from the prompt.
        onpointerdown: (event: Event) => event.preventDefault(),
        onclick: () => {
          this.cursor = index;
          this.pickCurrent();
        },
      },
      h('span', { class: 'ao-pro-menu-title' }, row.title),
      remove,
    );
  }

  private sync(): void {
    [...this.el.children].forEach((row, index) => {
      const current = index === this.cursor;
      toggleClass(row, 'is-current', current);
      row.setAttribute('aria-selected', String(current));
      if (current) row.scrollIntoView({ block: 'nearest' });
    });
  }
}
