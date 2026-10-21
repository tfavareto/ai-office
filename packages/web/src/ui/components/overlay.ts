// Base classes for anchored popovers and modal dialogs: open/close animation, inert when closed, focus handling.
import type { AppContext, Component } from '../context';
import { focusables, h, toggleClass } from '../dom';
import { icon } from '../icons';
import type { DialogId, PopoverId } from '../state';

function setOpen(el: HTMLElement, open: boolean): void {
  toggleClass(el, 'is-open', open);
  if (open) el.removeAttribute('inert');
  else el.setAttribute('inert', '');
  el.setAttribute('aria-hidden', String(!open));
}

export abstract class Popover implements Component {
  readonly el: HTMLElement;
  private wasOpen = false;

  constructor(
    protected readonly ctx: AppContext,
    private readonly id: PopoverId,
    label: string,
    className = '',
  ) {
    this.el = h('section', {
      class: `ao-popover ${className}`.trim(),
      role: 'dialog',
      'aria-label': label,
      tabindex: '-1',
      'data-popover': id,
    });
    setOpen(this.el, false);
  }

  /** Called when the popover opens (fetch data, reset fields). */
  protected abstract onOpen(): void;
  /** Called on every render pass while open; must be cheap when nothing changed. */
  protected abstract update(): void;

  focusTarget(): HTMLElement {
    return this.el;
  }

  render(): void {
    const open = this.ctx.ui.get().popover === this.id;
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      setOpen(this.el, open);
      if (open) {
        this.anchor();
        this.onOpen();
        queueMicrotask(() => this.focusTarget().focus({ preventScroll: true }));
      }
    }
    if (open) this.update();
  }

  /** Aligns the popover under its trigger button (read once, when opening). */
  private anchor(): void {
    const trigger = document.querySelector<HTMLElement>(`[data-popover-trigger="${this.id}"]`);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right - 4);
    this.el.style.setProperty('--popover-right', `${right}px`);
    this.el.style.setProperty('--popover-top', `${rect.bottom + 8}px`);
  }
}

export abstract class Dialog implements Component {
  readonly el: HTMLElement;
  protected readonly panel: HTMLElement;
  private wasOpen = false;
  private returnFocus: HTMLElement | null = null;

  constructor(
    protected readonly ctx: AppContext,
    private readonly id: DialogId,
    protected readonly titleId: string,
    className = '',
  ) {
    this.panel = h('div', {
      class: `ao-dialog ${className}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      tabindex: '-1',
    });
    this.el = h('div', { class: 'ao-scrim ao-dialog-scrim', 'data-dialog': id }, this.panel);
    this.el.addEventListener('pointerdown', (event) => {
      if (event.target === this.el) this.ctx.closeDialog();
    });
    this.el.addEventListener('keydown', (event) => this.trapFocus(event));
    setOpen(this.el, false);
  }

  protected abstract onOpen(): void;
  protected abstract update(): void;
  /** Called when the dialog closes (stop timers and pending requests). */
  protected onClose(): void {}

  render(): void {
    const open = this.ctx.ui.get().dialog === this.id;
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      setOpen(this.el, open);
      if (open) {
        this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.onOpen();
        queueMicrotask(() => (focusables(this.panel)[0] ?? this.panel).focus({ preventScroll: true }));
      } else {
        this.onClose();
        this.returnFocus?.focus({ preventScroll: true });
        this.returnFocus = null;
      }
    }
    if (open) this.update();
  }

  private trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = focusables(this.panel);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === this.panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

export function closeButton(label: string, onClick: () => void): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': label, title: label, onclick: onClick },
    icon('x', 16),
  );
}
