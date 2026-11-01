// The search of the Pro view (Cmd/Ctrl+P): find any agent, project or action and act on it from the keyboard. Enter
// goes to it, Shift+Enter checks an agent (its terminal, maximized) and Tab asks it something without leaving the
// box, with the same prompt as the rest of the view.
import { t } from '../../i18n';
import type { AppContext } from '../../ui/context';
import { h, setText, toggleClass } from '../../ui/dom';
import { buildTargets } from '../model/command';
import { searchPalette, type PaletteItem, type PaletteKind } from '../model/palette';
import { PromptBox } from './prompt-box';

const KIND_GLYPH: Record<PaletteKind, string> = { agent: '@', room: '#', action: '>' };

export interface PaletteHost {
  /** Everything that can be found, fresh from the office. */
  items(): readonly PaletteItem[];
  /** Runs what Enter means for the item. */
  go(item: PaletteItem): void;
  /** Shows an agent's terminal maximized. */
  check(agentId: string): void;
  /** The agent's name and whom an order to it goes to (a subagent's orchestrator). */
  askTarget(agentId: string): { name: string; targetId: string } | undefined;
}

export class Palette {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list = h('ul', { class: 'ao-pro-palette-list', role: 'listbox' });
  private readonly hint = h('p', { class: 'ao-pro-palette-hint' }, t('pro.palette.hint'));
  private readonly empty = h('p', { class: 'ao-pro-palette-empty', hidden: true }, t('pro.palette.empty'));
  private readonly askTitle = h('p', { class: 'ao-pro-palette-ask-title' });
  private readonly prompt: PromptBox;
  private readonly askArea: HTMLElement;
  private readonly box: HTMLElement;
  private results: readonly PaletteItem[] = [];
  private cursor = 0;
  private asking = false;
  private restoreFocus: HTMLElement | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly host: PaletteHost,
  ) {
    this.input = h('input', {
      type: 'text',
      class: 'ao-pro-palette-input',
      placeholder: t('pro.palette.placeholder'),
      'aria-label': t('pro.palette.label'),
      spellcheck: 'false',
      autocomplete: 'off',
    });
    this.input.addEventListener('input', () => {
      this.cursor = 0;
      this.refreshResults();
    });
    this.prompt = new PromptBox(ctx, ctx.voice.input, { label: t('pro.palette.label'), quick: false });
    this.askArea = h('div', { class: 'ao-pro-palette-ask', hidden: true }, this.askTitle, this.prompt.el);
    this.box = h(
      'section',
      {
        class: 'ao-pro-palette',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('pro.palette.label'),
        tabindex: '-1',
      },
      this.input,
      this.list,
      this.empty,
      this.askArea,
      this.hint,
    );
    this.el = h(
      'div',
      {
        class: 'ao-pro-palette-scrim',
        hidden: true,
        onpointerdown: (event: Event) => {
          if (event.target === this.el) this.close();
        },
      },
      this.box,
    );
    this.el.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  dispose(): void {
    this.prompt.dispose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    const active = document.activeElement;
    this.restoreFocus = active instanceof HTMLElement ? active : null;
    this.el.hidden = false;
    this.setAsking(false);
    this.input.value = '';
    this.cursor = 0;
    this.refreshResults();
    this.input.focus();
  }

  close(): void {
    this.el.hidden = true;
    this.restoreFocus?.focus({ preventScroll: true });
    this.restoreFocus = null;
  }

  /** Keeps an open question up to date with what its target is doing. */
  render(): void {
    if (!this.isOpen || !this.asking) return;
    const item = this.results[this.cursor];
    if (item !== undefined) this.aimAt(item.id);
  }

  private refreshResults(): void {
    this.results = searchPalette(this.host.items(), this.input.value);
    this.empty.hidden = this.results.length > 0;
    this.list.replaceChildren(...this.results.map((item, index) => this.row(item, index)));
    this.syncCursor();
  }

  private row(item: PaletteItem, index: number): HTMLElement {
    return h(
      'li',
      {
        class: 'ao-pro-palette-row',
        role: 'option',
        'aria-selected': 'false',
        onpointerenter: () => this.moveTo(index),
        onclick: () => this.run(item),
      },
      h('span', { class: 'ao-pro-palette-glyph', 'aria-hidden': 'true' }, KIND_GLYPH[item.kind]),
      h('span', { class: 'ao-pro-palette-title' }, item.title),
      h('span', { class: 'ao-pro-palette-detail' }, item.detail),
      item.waiting ? h('span', { class: 'ao-pro-palette-waiting', 'aria-hidden': 'true' }, '◆') : '',
    );
  }

  private moveTo(index: number): void {
    this.cursor = index;
    this.syncCursor();
  }

  private syncCursor(): void {
    [...this.list.children].forEach((row, index) => {
      const current = index === this.cursor;
      toggleClass(row, 'is-current', current);
      row.setAttribute('aria-selected', String(current));
      if (current) row.scrollIntoView({ block: 'nearest' });
    });
  }

  private run(item: PaletteItem): void {
    this.close();
    this.host.go(item);
  }

  private setAsking(on: boolean): void {
    this.asking = on;
    this.askArea.hidden = !on;
    this.list.hidden = on;
    this.input.hidden = on;
    this.hint.hidden = on;
    this.empty.hidden = on || this.results.length > 0;
  }

  /** Aims the prompt at the agent; false when no order can go to it. */
  private aimAt(agentId: string): boolean {
    const target = this.host.askTarget(agentId);
    if (target === undefined) return false;
    setText(this.askTitle, t('pro.palette.ask.title', { name: target.name }));
    const targets = buildTargets(this.ctx.liveSnapshot, this.ctx.now(), this.ctx.isLocal);
    this.prompt.setTarget(targets.find((candidate) => candidate.key === `agent:${target.targetId}`));
    return true;
  }

  private startAsking(item: PaletteItem): void {
    if (item.kind !== 'agent' || !this.aimAt(item.id)) return;
    this.setAsking(true);
    this.prompt.focus();
    // A target that takes no orders disables the box: the keyboard stays here, so Esc still works.
    if (!this.el.contains(document.activeElement)) this.box.focus();
  }

  private onKeyDown(event: KeyboardEvent): void {
    // The rest of the page never sees the keys of this box (Esc must not close anything underneath).
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!this.asking) return this.close();
      this.setAsking(false);
      this.input.focus();
      return;
    }
    if (!this.asking) this.onSearchKey(event);
  }

  private onSearchKey(event: KeyboardEvent): void {
    const count = this.results.length;
    const item = this.results[this.cursor];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count > 0) this.moveTo((this.cursor + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      if (item !== undefined) this.startAsking(item);
    } else if (event.key === 'Enter' && item !== undefined) {
      event.preventDefault();
      if (event.shiftKey && item.kind === 'agent') {
        this.close();
        this.host.check(item.id);
      } else this.run(item);
    }
  }
}
