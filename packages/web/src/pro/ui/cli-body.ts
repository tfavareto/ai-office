// The text of a canvas terminal, printed like the Claude Code CLI (see `model/cli-format.ts`): newest at the bottom,
// following the end unless the reader scrolled up. Bounded: only the last `windowSize` entries are in the DOM, and an
// update touches only the entries that changed (see `planRender`). Under the conversation a "tail" can hold what the
// agent is waiting for (the permission prompt).
import type { TranscriptEntry } from '@ai-office/shared';
import { t } from '../../i18n';
import { h } from '../../ui/dom';
import { canExpand, formatEntry, RESULT_LINES, type CliLine } from '../model/cli-format';
import { entryKey, planRender, windowOf, WINDOW_ENTRIES } from '../model/live-transcript';

const STICK_THRESHOLD_PX = 40;
const EARLIER_STEP = 40;

interface Item {
  entry: TranscriptEntry;
  el: HTMLElement;
}

function lineElement(line: CliLine, toggle: (() => void) | null): HTMLElement {
  const text = h('span', { class: 'ao-cli-text' }, line.text);
  const gutter = h('span', { class: 'ao-cli-gutter', 'aria-hidden': 'true' }, line.gutter);
  const className = `ao-cli-line is-${line.kind} tone-${line.tone}`;
  if (toggle !== null && (line.kind === 'more' || line.kind === 'thinking'))
    return h('button', { type: 'button', class: `${className} is-toggle`, onclick: toggle }, gutter, text);
  return h('div', { class: className }, gutter, text);
}

export class CliBody {
  readonly el = h('div', { class: 'ao-pro-body', role: 'log', 'aria-live': 'off', tabindex: '0' });
  private readonly list = h('div', { class: 'ao-cli-list' });
  private readonly tail = h('div', { class: 'ao-cli-tail' });
  private items: Item[] = [];
  private earlier: HTMLButtonElement | null = null;
  private placeholder: HTMLElement | null = null;
  private readonly expanded = new Set<string>();
  private entries: readonly TranscriptEntry[] = [];
  private windowSize = WINDOW_ENTRIES;
  private resultLines = RESULT_LINES;
  private stick = true;
  private savedTop = 0;
  private cwd: string | undefined;

  constructor(private readonly onStickChange: (sticking: boolean) => void) {
    this.el.append(this.list, this.tail);
    this.el.addEventListener('scroll', () => this.onScroll(), { passive: true });
  }

  /** The most entries shown at once and the result lines per call; a change redraws everything. */
  configure(windowSize: number, resultLines: number): void {
    if (windowSize === this.windowSize && resultLines === this.resultLines) return;
    this.windowSize = windowSize;
    this.resultLines = resultLines;
    this.clear();
    this.update(this.entries);
  }

  /** The session's folder (paths in it are printed relative to it). */
  setCwd(cwd: string): void {
    this.cwd = cwd;
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

  /** A line under the conversation (an error), or null. */
  setNote(text: string | null): void {
    if (text === null) {
      this.placeholder?.remove();
      this.placeholder = null;
      return;
    }
    if (this.placeholder === null) {
      this.placeholder = h('div', { class: 'ao-cli-line is-system tone-error' });
      this.list.after(this.placeholder);
    }
    this.placeholder.replaceChildren(
      h('span', { class: 'ao-cli-gutter', 'aria-hidden': 'true' }, '✗'),
      h('span', { class: 'ao-cli-text' }, text),
    );
  }

  /** What the agent waits for, under the conversation (null to remove it). */
  setTail(node: HTMLElement | null): void {
    if (node === null) {
      if (this.tail.firstChild !== null) this.tail.replaceChildren();
    } else if (this.tail.firstChild !== node) this.tail.replaceChildren(node);
    if (this.stick) this.el.scrollTop = this.el.scrollHeight;
  }

  update(entries: readonly TranscriptEntry[]): void {
    this.entries = entries;
    const target = windowOf(entries, this.windowSize);
    const plan = planRender(
      this.items.map((item) => item.entry),
      target,
    );
    for (const item of this.items.splice(0, plan.dropFront)) item.el.remove();
    for (const item of this.items.splice(plan.keep)) item.el.remove();
    const fragment = document.createDocumentFragment();
    for (const entry of plan.append) {
      const item = this.createItem(entry);
      this.items.push(item);
      fragment.appendChild(item.el);
    }
    this.list.appendChild(fragment);
    this.syncEarlier(entries.length - target.length);
    if (this.stick) this.el.scrollTop = this.el.scrollHeight;
  }

  private createItem(entry: TranscriptEntry): Item {
    const key = entryKey(entry);
    const expanded = this.expanded.has(key);
    const toggle = canExpand(entry, this.resultLines) || expanded ? () => this.toggle(key) : null;
    const lines = formatEntry(entry, {
      resultLines: this.resultLines,
      expanded,
      ...(this.cwd !== undefined ? { cwd: this.cwd } : {}),
    });
    const el = h('div', { class: `ao-cli-entry is-${entry.kind}` }, ...lines.map((line) => lineElement(line, toggle)));
    if (expanded && toggle !== null && entry.kind === 'tool')
      el.appendChild(lineElement({ kind: 'more', gutter: '', text: t('pro.term.less'), tone: 'dim' }, toggle));
    return { entry, el };
  }

  /** Opens or closes a long result or a thinking block, keeping everything else where it is. */
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
        class: 'ao-cli-earlier',
        onclick: () => this.showEarlier(),
      });
    this.earlier.textContent = t('terminal.earlier', { n: hidden });
    if (this.earlier.parentElement !== this.list) this.list.prepend(this.earlier);
  }

  private showEarlier(): void {
    this.windowSize += EARLIER_STEP;
    this.stick = false;
    this.update(this.entries);
  }

  private clear(): void {
    for (const item of this.items) item.el.remove();
    this.items = [];
    this.earlier?.remove();
    this.earlier = null;
  }

  private onScroll(): void {
    const distance = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight;
    const sticking = distance <= STICK_THRESHOLD_PX;
    if (sticking === this.stick) return;
    this.stick = sticking;
    this.onStickChange(sticking);
  }
}
