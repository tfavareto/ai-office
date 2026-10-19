// Read-only terminal: renders a session's conversation like Claude Code does, live-updating, with search.
import type { TranscriptEntry } from '@ai-office/shared';
import { describeError } from '../../net/backend';
import { t } from '../../i18n';
import { localOnlyHint, type AppContext, type Component } from '../context';
import { agentRole, agentTitle, localized, toolSummary } from '../display';
import { compact, h, setText, toggleClass } from '../dom';
import { formatClock } from '../format';
import { icon } from '../icons';
import {
  EMPTY_TRANSCRIPT,
  entrySearchText,
  findMatches,
  mergeTranscript,
  occurrencesIn,
  splitFences,
  splitHighlight,
  stepMatch,
  toolPreview,
  type TermMatch,
  type TranscriptState,
} from '../model/terminal';
import type { TerminalTarget } from '../state';
import { closeButton } from './overlay';

const POLL_MS = 1500;
const RENDER_WINDOW = 400;
const STICK_THRESHOLD_PX = 48;

function targetKey(target: TerminalTarget): string {
  return `${target.accountId}|${target.sessionId}|${target.agentId ?? ''}`;
}

interface Highlighter {
  /** Appends `text` to `parent`, wrapping search hits in <mark>. */
  append(parent: HTMLElement, text: string): void;
}

export class TerminalPanel implements Component {
  readonly el = h('section', { class: 'ao-terminal', 'aria-label': t('terminal.label') });
  private readonly title = h('strong', { class: 'ao-terminal-title' });
  private readonly subtitle = h('span', { class: 'ao-terminal-subtitle' });
  private readonly badge = h('span', { class: 'ao-tag' });
  private readonly body = h('div', { class: 'ao-terminal-body', tabindex: '0', role: 'log', 'aria-live': 'off' });
  private readonly toEnd: HTMLButtonElement;
  private readonly searchBar = h('div', { class: 'ao-terminal-search', hidden: true });
  private readonly searchInput: HTMLInputElement;
  private readonly searchCount = h('span', { class: 'ao-terminal-count' });
  private readonly expandBtn: HTMLButtonElement;
  private state: TranscriptState = EMPTY_TRANSCRIPT;
  private key = '';
  private status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private errorText = '';
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private token = 0;
  private stick = true;
  private expandAll = false;
  private readonly expanded = new Set<number>();
  private startIndex = 0;
  private renderedUntil = 0;
  private query = '';
  private matches: TermMatch[] = [];
  private active = -1;
  private needsFullRender = true;
  private wasOpen = false;

  constructor(private readonly ctx: AppContext) {
    this.toEnd = h('button', { type: 'button', class: 'ao-btn ao-btn--soft ao-btn--small ao-terminal-end', hidden: true, onclick: () => this.scrollToEnd() }, icon('arrowDown', 14), h('span', null, t('terminal.toEnd')));
    this.searchInput = h('input', { type: 'search', class: 'ao-input', placeholder: t('terminal.search'), 'aria-label': t('terminal.search'), autocomplete: 'off' });
    this.searchInput.addEventListener('input', () => this.setQuery(this.searchInput.value));
    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      }
    });
    this.searchBar.append(
      this.searchInput,
      this.searchCount,
      this.iconBtn('chevronUp', t('terminal.search.prev'), () => this.step(-1)),
      this.iconBtn('chevronDown', t('terminal.search.next'), () => this.step(1)),
      this.iconBtn('x', t('terminal.search.close'), () => this.closeSearch()),
    );
    this.expandBtn = this.iconBtn('layers', t('terminal.expand'), () => this.toggleExpandAll());
    const searchBtn = this.iconBtn('search', t('terminal.search.open'), () => this.openSearch());
    this.el.append(
      h('header', { class: 'ao-terminal-head' }, h('div', { class: 'ao-terminal-heading' }, this.title, this.subtitle), this.badge, searchBtn, this.expandBtn, closeButton(t('terminal.close'), () => ctx.closeTerminal())),
      this.searchBar,
      this.body,
      this.toEnd,
    );
    this.body.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.el.setAttribute('inert', '');
  }

  private iconBtn(name: Parameters<typeof icon>[0], label: string, onClick: () => void): HTMLButtonElement {
    return h('button', { type: 'button', class: 'ao-iconbtn ao-iconbtn--small', 'aria-label': label, title: label, onclick: onClick }, icon(name, 16));
  }

  // --- search --------------------------------------------------------------------------------------------------------

  openSearch(): void {
    this.searchBar.hidden = false;
    this.searchInput.focus();
    this.searchInput.select();
  }

  closeSearch(): void {
    this.searchBar.hidden = true;
    this.searchInput.value = '';
    this.setQuery('');
    this.body.focus();
  }

  /** Esc handling: closes the search first. Returns true when it consumed the key. */
  handleEscape(): boolean {
    if (!this.wasOpen || this.searchBar.hidden) return false;
    this.closeSearch();
    return true;
  }

  get isOpen(): boolean {
    return this.wasOpen;
  }

  dispose(): void {
    this.stop();
  }

  private setQuery(query: string): void {
    this.query = query;
    this.matches = findMatches(this.state.entries, query);
    this.active = this.matches.length > 0 ? 0 : -1;
    this.needsFullRender = true;
    this.updateCount();
    this.ctx.refresh();
  }

  private step(direction: 1 | -1): void {
    this.active = stepMatch(this.matches.length, this.active, direction);
    this.needsFullRender = true;
    this.updateCount();
    this.ctx.refresh();
    this.revealActive = true;
  }

  private revealActive = false;

  private updateCount(): void {
    setText(this.searchCount, !this.query ? '' : this.matches.length === 0 ? t('terminal.search.none') : t('terminal.search.count', { current: this.active + 1, total: this.matches.length }));
  }

  private toggleExpandAll(): void {
    this.expandAll = !this.expandAll;
    this.expandBtn.setAttribute('aria-pressed', String(this.expandAll));
    toggleClass(this.expandBtn, 'is-on', this.expandAll);
    this.needsFullRender = true;
    this.ctx.refresh();
  }

  // --- lifecycle -----------------------------------------------------------------------------------------------------

  render(): void {
    const target = this.ctx.ui.get().terminal;
    const open = target !== null;
    toggleClass(this.el, 'is-open', open);
    this.el.setAttribute('aria-hidden', String(!open));
    if (open) this.el.removeAttribute('inert');
    else this.el.setAttribute('inert', '');
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      if (!open) {
        this.stop();
        this.key = '';
        return;
      }
    }
    if (!target) return;
    const key = targetKey(target);
    if (key !== this.key) {
      this.key = key;
      this.begin(target);
    }
    this.renderHeader(target);
    this.renderBody();
  }

  private begin(target: TerminalTarget): void {
    this.stop();
    this.state = EMPTY_TRANSCRIPT;
    this.status = 'loading';
    this.errorText = '';
    this.expanded.clear();
    this.startIndex = 0;
    this.renderedUntil = 0;
    this.matches = [];
    this.active = -1;
    this.stick = true;
    this.needsFullRender = true;
    if (!this.ctx.isLocal) {
      this.status = 'error';
      this.errorText = localOnlyHint();
      return;
    }
    void this.fetch(target, 0);
  }

  private stop(): void {
    this.token++;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async fetch(target: TerminalTarget, after: number): Promise<void> {
    const token = this.token;
    try {
      const page = await this.ctx.store.backend.transcript({ sessionId: target.sessionId, accountId: target.accountId, agentId: target.agentId, after });
      if (token !== this.token) return;
      const previous = this.state;
      this.state = mergeTranscript(this.state, page, after);
      this.status = 'ready';
      this.errorText = '';
      if (this.state !== previous && this.query) this.matches = findMatches(this.state.entries, this.query);
    } catch (error) {
      if (token !== this.token) return;
      if (after === 0) {
        this.status = 'error';
        this.errorText = describeError(error);
      }
    }
    this.ctx.refresh();
    this.schedulePoll(target, token);
  }

  private schedulePoll(target: TerminalTarget, token: number): void {
    if (token !== this.token || this.status !== 'ready' || !this.state.open) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      if (token !== this.token) return;
      if (document.hidden) this.schedulePoll(target, token);
      else void this.fetch(target, this.state.next);
    }, POLL_MS);
  }

  private retry(): void {
    const target = this.ctx.ui.get().terminal;
    if (target) this.begin(target);
    this.ctx.refresh();
  }

  // --- rendering -----------------------------------------------------------------------------------------------------

  /** Live agents are described from the current snapshot so the text follows the language; closed sessions keep theirs. */
  private subtitleOf(target: TerminalTarget): string {
    const agent = target.officeAgentId ? this.ctx.agent(target.officeAgentId) : undefined;
    if (!agent) return target.subtitle ?? '';
    return [this.ctx.project(agent.projectId)?.name, agent.kind === 'sub' ? agentRole(agent) : agentTitle(agent)].filter(Boolean).join(' · ');
  }

  private renderHeader(target: TerminalTarget): void {
    setText(this.title, target.title);
    setText(this.subtitle, this.subtitleOf(target));
    const live = this.status === 'ready' && this.state.open;
    this.badge.className = `ao-tag ${live ? 'ao-tag--live' : ''}`.trim();
    setText(this.badge, live ? t('terminal.badge.live') : t('terminal.badge.readOnly'));
  }

  private renderBody(): void {
    if (this.status !== 'ready') {
      this.renderPlaceholder();
      return;
    }
    const entries = this.state.entries;
    if (entries.length === 0) {
      this.body.replaceChildren(h('p', { class: 'ao-note' }, t('terminal.empty')));
      this.renderedUntil = 0;
      return;
    }
    if (this.needsFullRender || entries.length < this.renderedUntil) this.renderAll();
    else if (entries.length > this.renderedUntil) this.appendNew();
    if (this.revealActive) {
      this.revealActive = false;
      this.body.querySelector('mark.is-active')?.scrollIntoView({ block: 'center' });
    }
  }

  private renderPlaceholder(): void {
    if (this.status === 'loading') {
      this.body.replaceChildren(h('p', { class: 'ao-note' }, t('terminal.loading')));
    } else if (this.status === 'error') {
      this.body.replaceChildren(...compact(h('p', { class: 'ao-error' }, this.errorText), this.ctx.isLocal ? h('button', { type: 'button', class: 'ao-btn ao-btn--soft', onclick: () => this.retry() }, t('common.retry')) : null));
    }
    this.renderedUntil = 0;
    this.needsFullRender = true;
  }

  private renderAll(): void {
    const entries = this.state.entries;
    this.needsFullRender = false;
    this.startIndex = Math.max(this.startIndex === 0 && entries.length > RENDER_WINDOW ? entries.length - RENDER_WINDOW : this.startIndex, 0);
    if (this.startIndex > entries.length) this.startIndex = 0;
    const frag = document.createDocumentFragment();
    if (this.startIndex > 0) {
      frag.appendChild(h('button', { type: 'button', class: 'ao-btn ao-btn--ghost ao-more', onclick: () => this.loadEarlier() }, t('terminal.earlier', { n: this.startIndex })));
    }
    for (let i = this.startIndex; i < entries.length; i++) frag.appendChild(this.entryEl(entries[i], i));
    this.body.replaceChildren(frag);
    this.renderedUntil = entries.length;
    if (this.stick && !this.revealActive) this.body.scrollTop = this.body.scrollHeight;
  }

  private appendNew(): void {
    const entries = this.state.entries;
    const stick = this.stick;
    const frag = document.createDocumentFragment();
    for (let i = this.renderedUntil; i < entries.length; i++) frag.appendChild(this.entryEl(entries[i], i));
    this.body.appendChild(frag);
    this.renderedUntil = entries.length;
    if (stick) this.body.scrollTop = this.body.scrollHeight;
  }

  private loadEarlier(): void {
    this.startIndex = Math.max(0, this.startIndex - RENDER_WINDOW);
    this.needsFullRender = true;
    this.stick = false;
    this.ctx.refresh();
  }

  private onScroll(): void {
    const distance = this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight;
    this.stick = distance <= STICK_THRESHOLD_PX;
    this.toEnd.hidden = this.stick;
  }

  private scrollToEnd(): void {
    this.stick = true;
    this.body.scrollTop = this.body.scrollHeight;
    this.toEnd.hidden = true;
  }

  private highlighter(entryIndex: number, counter: { n: number }): Highlighter {
    const activeMatch = this.active >= 0 ? this.matches[this.active] : undefined;
    return {
      append: (parent, text) => {
        if (!this.query) {
          parent.appendChild(document.createTextNode(text));
          return;
        }
        for (const piece of splitHighlight(text, this.query)) {
          if (piece.match < 0) {
            parent.appendChild(document.createTextNode(piece.text));
            continue;
          }
          const isActive = activeMatch?.entryIndex === entryIndex && activeMatch.occurrence === counter.n + piece.match;
          parent.appendChild(h('mark', { class: isActive ? 'is-active' : null }, piece.text));
        }
        counter.n += occurrencesIn(text, this.query).length;
      },
    };
  }

  private isExpanded(index: number, entry: TranscriptEntry): boolean {
    if (this.expandAll || this.expanded.has(index)) return true;
    return this.query !== '' && occurrencesIn(entrySearchText(entry), this.query).length > 0;
  }

  private entryEl(entry: TranscriptEntry, index: number): HTMLElement {
    const counter = { n: 0 };
    const hl = this.highlighter(index, counter);
    switch (entry.kind) {
      case 'user':
        return this.userEl(entry, hl);
      case 'assistant':
        return this.assistantEl(entry, hl);
      case 'thinking':
        return this.thinkingEl(entry, index, hl);
      case 'tool':
        return this.toolEl(entry, index, hl);
      case 'system': {
        const el = h('div', { class: 'ao-term-entry ao-term-system' });
        hl.append(el, localized(entry.msg, entry.text));
        return el;
      }
    }
  }

  private userEl(entry: Extract<TranscriptEntry, { kind: 'user' }>, hl: Highlighter): HTMLElement {
    const text = h('div', { class: 'ao-term-text' });
    hl.append(text, entry.text);
    return h('div', { class: 'ao-term-entry ao-term-user' }, h('span', { class: 'ao-term-prompt', 'aria-hidden': 'true' }, '❯'), text, h('time', { class: 'ao-term-time' }, formatClock(entry.at)));
  }

  private assistantEl(entry: Extract<TranscriptEntry, { kind: 'assistant' }>, hl: Highlighter): HTMLElement {
    const text = h('div', { class: 'ao-term-text' });
    for (const block of splitFences(entry.text)) {
      const el = h(block.kind === 'code' ? 'pre' : 'p', { class: block.kind === 'code' ? 'ao-term-code' : 'ao-term-para' });
      hl.append(el, block.text);
      text.appendChild(el);
    }
    return h('div', { class: 'ao-term-entry ao-term-assistant' }, h('span', { class: 'ao-term-bullet', 'aria-hidden': 'true' }, '●'), text);
  }

  private toggleEntry(index: number): void {
    if (this.expanded.has(index)) this.expanded.delete(index);
    else this.expanded.add(index);
    this.needsFullRender = true;
    this.stick = false;
    this.ctx.refresh();
  }

  private thinkingEl(entry: Extract<TranscriptEntry, { kind: 'thinking' }>, index: number, hl: Highlighter): HTMLElement {
    const open = this.isExpanded(index, entry);
    const toggle = h('button', { type: 'button', class: 'ao-term-toggle', 'aria-expanded': String(open), onclick: () => this.toggleEntry(index) }, icon(open ? 'chevronDown' : 'chevronRight', 12), h('span', null, t('terminal.thinking')));
    const el = h('div', { class: `ao-term-entry ao-term-thinking ${open ? 'is-open' : ''}`.trim() }, toggle);
    if (open) {
      const text = h('div', { class: 'ao-term-text' });
      hl.append(text, entry.text);
      el.appendChild(text);
    }
    return el;
  }

  private toolEl(entry: Extract<TranscriptEntry, { kind: 'tool' }>, index: number, hl: Highlighter): HTMLElement {
    const open = this.isExpanded(index, entry);
    const name = h('strong', { class: 'ao-term-tool-name' });
    hl.append(name, entry.name);
    const summary = h('span', { class: 'ao-term-tool-summary' });
    hl.append(summary, toolSummary(entry));
    const head = h('div', { class: 'ao-term-tool-head' }, h('span', { class: `ao-term-bullet ${entry.error ? 'is-error' : ''}`.trim(), 'aria-hidden': 'true' }, '●'), name, summary);
    const el = h('div', { class: `ao-term-entry ao-term-tool ${entry.error ? 'is-error' : ''} ${open ? 'is-open' : ''}`.trim() }, head);
    if (entry.result) {
      const { preview, hiddenLines } = toolPreview(entry.result);
      const result = h('pre', { class: 'ao-term-result' });
      if (open) hl.append(result, entry.result);
      else result.textContent = preview;
      el.appendChild(result);
      if (hiddenLines > 0 || open) {
        el.appendChild(h('button', { type: 'button', class: 'ao-term-toggle', 'aria-expanded': String(open), onclick: () => this.toggleEntry(index) }, icon(open ? 'chevronUp' : 'chevronDown', 12), h('span', null, open ? t('terminal.collapse') : t('terminal.moreLines', { n: hiddenLines }))));
      }
    }
    return el;
  }
}
