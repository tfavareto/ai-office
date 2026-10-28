// The conversation inside a canvas terminal: Claude Code's lines, the newest at the bottom, following the end unless the
// user scrolled up. Bounded: only the last `windowSize` entries are in the DOM, and an update touches only the lines
// that changed (see `planRender`).
import type { TranscriptEntry } from '@ai-office/shared';
import { t } from '../../i18n';
import { h } from '../../ui/dom';
import { entryElement, plainText, type EntryView } from '../../ui/components/transcript-entry';
import { entryKey, planRender, windowOf, WINDOW_ENTRIES } from '../model/live-transcript';

const STICK_THRESHOLD_PX = 40;
const EARLIER_STEP = 40;

interface Item {
  entry: TranscriptEntry;
  el: HTMLElement;
}

export class TranscriptBody {
  readonly el = h('div', { class: 'ao-pro-body', role: 'log', 'aria-live': 'off', tabindex: '0' });
  private items: Item[] = [];
  private placeholder: HTMLElement | null = null;
  private earlier: HTMLButtonElement | null = null;
  private readonly expanded = new Set<string>();
  private entries: readonly TranscriptEntry[] = [];
  private windowSize = WINDOW_ENTRIES;
  private stick = true;
  private savedTop = 0;

  constructor(private readonly onStickChange: (sticking: boolean) => void) {
    this.el.addEventListener('scroll', () => this.onScroll(), { passive: true });
  }

  get sticking(): boolean {
    return this.stick;
  }

  /** The most entries shown at once (a maximized terminal shows more); the next update applies it. */
  setWindow(size: number): void {
    this.windowSize = size;
  }

  /** Moving the element to another parent resets its scroll: these two keep the reader where they were. */
  rememberScroll(): void {
    this.savedTop = this.el.scrollTop;
  }

  restoreScroll(): void {
    this.el.scrollTop = this.stick ? this.el.scrollHeight : this.savedTop;
  }

  scrollToEnd(): void {
    this.stick = true;
    this.el.scrollTop = this.el.scrollHeight;
    this.onStickChange(true);
  }

  /** A message instead of the conversation (loading, error, empty). */
  showMessage(text: string, kind: 'note' | 'error'): void {
    this.clearItems();
    if (this.placeholder?.textContent === text && this.placeholder.classList.contains(`ao-${kind}`)) return;
    this.placeholder = h('p', { class: `ao-${kind} ao-pro-note` }, text);
    this.el.replaceChildren(this.placeholder);
  }

  update(entries: readonly TranscriptEntry[]): void {
    this.entries = entries;
    if (entries.length === 0) {
      this.showMessage(t('terminal.empty'), 'note');
      return;
    }
    if (this.placeholder !== null) {
      this.placeholder.remove();
      this.placeholder = null;
    }
    const target = windowOf(entries, this.windowSize);
    const plan = planRender(
      this.items.map((item) => item.entry),
      target,
    );
    for (const item of this.items.splice(0, plan.dropFront)) item.el.remove();
    for (const item of this.items.splice(plan.keep)) item.el.remove();
    const wasSticking = this.stick;
    const fragment = document.createDocumentFragment();
    for (const entry of plan.append) {
      const item = this.createItem(entry);
      this.items.push(item);
      fragment.appendChild(item.el);
    }
    this.el.appendChild(fragment);
    this.syncEarlier(entries.length - target.length);
    if (wasSticking) this.el.scrollTop = this.el.scrollHeight;
  }

  private createItem(entry: TranscriptEntry): Item {
    const key = entryKey(entry);
    const view: EntryView = {
      text: () => plainText,
      isExpanded: () => this.expanded.has(key),
      toggle: () => this.toggle(key),
    };
    return { entry, el: entryElement(entry, 0, view) };
  }

  /** Opens or closes a thinking block or a long result, keeping everything else where it is. */
  private toggle(key: string): void {
    if (this.expanded.has(key)) this.expanded.delete(key);
    else this.expanded.add(key);
    const index = this.items.findIndex((item) => entryKey(item.entry) === key);
    const item = this.items[index];
    if (item === undefined) return;
    const next = this.createItem(item.entry);
    item.el.replaceWith(next.el);
    this.items[index] = next;
  }

  private syncEarlier(hidden: number): void {
    if (hidden <= 0) {
      this.earlier?.remove();
      this.earlier = null;
      return;
    }
    if (this.earlier === null)
      this.earlier = h('button', {
        type: 'button',
        class: 'ao-btn ao-btn--ghost ao-btn--small ao-pro-earlier',
        onclick: () => this.showEarlier(),
      });
    this.earlier.textContent = t('terminal.earlier', { n: hidden });
    if (this.earlier.parentElement !== this.el) this.el.prepend(this.earlier);
  }

  private showEarlier(): void {
    this.windowSize += EARLIER_STEP;
    this.stick = false;
    this.update(this.entries);
  }

  private clearItems(): void {
    this.items = [];
    this.earlier = null;
    if (this.el.firstChild !== null && this.placeholder === null) this.el.replaceChildren();
  }

  private onScroll(): void {
    const distance = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight;
    const sticking = distance <= STICK_THRESHOLD_PX;
    if (sticking === this.stick) return;
    this.stick = sticking;
    this.onStickChange(sticking);
  }
}
