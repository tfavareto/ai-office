// One terminal window of the canvas, raw: a plain title line (session name, role, `[account]` or `[codex]`, model,
// session time, maximize and copy-id buttons), the session printed like the Claude Code CLI, what it waits for (the
// permission prompt, amber, answered right there), and a CLI-like status line. It always shows terminal text: live from the transcript
// when the policy lets it poll, otherwise the last lines it already has followed by what the office saw the agent do.
import type { XtermView } from './xterm-view';
import { isCodex, type Account, type Agent, type TranscriptEntry } from '@ai-office/shared';
import { describeError } from '../../net/backend';
import { t, type TextKey } from '../../i18n';
import { accountInitial, accountLabel, agentRole, agentTitle } from '../../ui/display';
import { h, setAttr, setText, toggleClass } from '../../ui/dom';
import { icon, type IconName } from '../../ui/icons';
import { displayStatus, statusLabel } from '../../ui/model/status';
import { liveText, setLive } from '../../ui/widgets';
import { ActivityEntryCache, NO_RESULT } from '../model/activity-entries';
import { RESULT_LINES, RESULT_LINES_MAXIMIZED, shortModel, statusLine } from '../model/cli-format';
import { demoResult } from '../model/demo-results';
import type { Rect } from '../model/geometry';
import { WINDOW_ENTRIES, WINDOW_MAXIMIZED, WINDOW_RECENT, withNewer } from '../model/live-transcript';
import type { Detail } from '../model/policy';
import type { FinishedSub } from '../model/scene';
import { AskBox, type AskHost } from './ask-box';
import { CliBody } from './cli-body';
import { TranscriptFeed, type FeedSource } from './transcript-feed';

export interface NodeModel {
  agent: Agent;
  rect: Rect;
  isOrchestrator: boolean;
  account: Account | undefined;
  /** When it finished (faded subagents). */
  finishedAt: number | undefined;
  selected: boolean;
  maximized: boolean;
  /** Finished subagents folded into the orchestrator's pill. */
  collapsed: readonly FinishedSub[];
  /** The number key that goes to this orchestrator (1 to 9). */
  number: number | undefined;
}

export interface NodeHandlers extends AskHost {
  maximize(): void;
  copySessionId(): void;
  select(): void;
  /** Opens the real terminal on screen. */
  openXterm(terminalId: string, onRelease: () => void, onFocus: (focused: boolean) => void): XtermView;
  killTerminal(terminalId: string): void;
  /** A folded finished subagent was picked in the orchestrator's list: show its terminal. */
  openFinished(agent: Agent): void;
}

type ActionName = 'maximize' | 'copy';

/**
 * A resting terminal (not live) redraws what the office saw at most this often: with dozens of them on screen,
 * redrawing each on every snapshot would repaint the whole canvas many times a second for text that is often too
 * small to read. A live terminal is never held back.
 */
export const RESTING_REDRAW_MS = 1000;

const ACTIONS: readonly { name: ActionName; icon: IconName; key: TextKey }[] = [
  { name: 'maximize', icon: 'maximize', key: 'pro.node.maximize' },
  { name: 'copy', icon: 'copy', key: 'pro.node.copyId' },
];

/** How long the stop button waits for the second click. */
const KILL_CONFIRM_MS = 3000;

export class TerminalNode {
  readonly el = h('article', { class: 'ao-pro-node', tabindex: '0', role: 'group' });
  private readonly number = h('span', { class: 'ao-pro-number', hidden: true });
  private readonly name = h('strong', { class: 'ao-pro-name' });
  private readonly role = h('span', { class: 'ao-pro-role' });
  private readonly account = h('span', { class: 'ao-pro-badge' });
  private readonly codex = h(
    'span',
    { class: 'ao-pro-badge is-codex', hidden: true, title: t('codex.badge.title') },
    `[${t('codex.badge').toLowerCase()}]`,
  );
  private readonly model = h('span', { class: 'ao-pro-model' });
  private readonly elapsed = liveText('elapsed', 0, 'ao-pro-elapsed');
  private readonly task = h('p', { class: 'ao-pro-task' });
  private readonly body: CliBody;
  private readonly toEnd: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly statusGlyph = h('span', { class: 'ao-pro-status-glyph', 'aria-hidden': 'true' });
  private readonly statusText = h('span', { class: 'ao-pro-status-text' });
  private readonly statusTime = liveText('elapsed', 0, 'ao-pro-status-time');
  private readonly status = h('footer', { class: 'ao-pro-status' }, this.statusGlyph, this.statusText, this.statusTime);
  private readonly pill = h('button', { type: 'button', class: 'ao-pro-pill', hidden: true, 'data-no-drag': '' });
  private readonly doneList = h('div', { class: 'ao-pro-done', hidden: true });
  private readonly maximizeButton: HTMLButtonElement;
  private readonly liveFeed: TranscriptFeed;
  private readonly recent = new ActivityEntryCache();
  private readonly ask: AskBox;
  private readonly content = h('div', { class: 'ao-pro-content' });
  private readonly askSlot = h('div', { class: 'ao-pro-ask-slot', hidden: true });
  private readonly typing = h('span', { class: 'ao-pro-typing', hidden: true }, t('pro.terminal.typing'));
  private readonly killButton: HTMLButtonElement;
  private killArmed: ReturnType<typeof setTimeout> | null = null;
  private xterm: XtermView | null = null;
  private xtermId: string | null = null;
  private wantsTerminalFocus = false;
  private asking = false;
  private detail: Detail = 'summary';
  private maximized = false;
  private doneOpen = false;
  private doneSignature = '';
  private model_: NodeModel | null = null;
  private lastEventAt = 0;
  private lastRestingDraw = Number.NEGATIVE_INFINITY;
  private restingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly id: string,
    source: FeedSource,
    private readonly handlers: NodeHandlers,
  ) {
    this.liveFeed = new TranscriptFeed(source, () => this.renderBody());
    this.ask = new AskBox(handlers);
    this.body = new CliBody((sticking) => {
      this.toEnd.hidden = sticking;
    });
    this.toEnd = h(
      'button',
      {
        type: 'button',
        class: 'ao-pro-chip ao-pro-end',
        hidden: true,
        'data-no-drag': '',
        onclick: () => this.body.scrollToEnd(),
      },
      icon('arrowDown', 12),
      h('span', null, t('terminal.toEnd')),
    );
    this.retry = h(
      'button',
      {
        type: 'button',
        class: 'ao-pro-chip ao-pro-retry',
        hidden: true,
        'data-no-drag': '',
        onclick: () => this.liveFeed.retry(),
      },
      t('common.retry'),
    );
    this.maximizeButton = this.actionButton(ACTIONS[0] as (typeof ACTIONS)[number]);
    const buttons = [this.maximizeButton, ...ACTIONS.slice(1).map((action) => this.actionButton(action))];
    this.el.dataset.nodeId = id;
    // The first position is set without gliding in from the corner.
    this.el.classList.add('is-new');
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.remove('is-new')));
    this.pill.addEventListener('click', (event) => {
      event.stopPropagation();
      this.doneOpen = !this.doneOpen;
      this.doneSignature = '';
      this.renderDone();
    });
    this.status.appendChild(this.pill);
    this.status.appendChild(this.typing);
    this.content.append(this.body.el, this.toEnd, this.retry, this.doneList, this.askSlot);
    this.killButton = h(
      'button',
      {
        type: 'button',
        class: 'ao-pro-action ao-pro-kill',
        hidden: true,
        title: t('pro.terminal.kill'),
        'aria-label': t('pro.terminal.kill'),
        'data-no-drag': '',
        onclick: (event: Event) => {
          event.stopPropagation();
          this.onKillClick();
        },
      },
      icon('x', 13),
    );
    this.el.append(
      h(
        'header',
        { class: 'ao-pro-head', 'data-drag': '' },
        this.number,
        this.name,
        this.role,
        this.codex,
        this.account,
        this.model,
        h('span', { class: 'ao-pro-spacer' }),
        this.elapsed,
        h('div', { class: 'ao-pro-actions' }, this.killButton, ...buttons),
      ),
      this.task,
      this.content,
      this.status,
    );
    this.el.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Element && event.target.closest('button') !== null) return;
      this.handlers.select();
    });
    this.el.addEventListener('dblclick', (event) => {
      // In a real terminal a double click selects a word, as in any terminal.
      if (event.target instanceof Element && event.target.closest('button, .ao-pro-done, .ao-pro-xterm') !== null)
        return;
      event.preventDefault();
      this.handlers.maximize();
    });
  }

  private actionButton(action: (typeof ACTIONS)[number]): HTMLButtonElement {
    const button = h(
      'button',
      {
        type: 'button',
        class: 'ao-pro-action',
        'aria-label': t(action.key),
        title: t(action.key),
        'data-no-drag': '',
      },
      icon(action.icon, 13),
    );
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (action.name === 'maximize') this.handlers.maximize();
      else this.handlers.copySessionId();
    });
    return button;
  }

  // --- model ------------------------------------------------------------------------------------------------------

  update(model: NodeModel): void {
    this.model_ = model;
    const { agent } = model;
    this.body.setCwd(agent.projectId);
    const status = model.finishedAt !== undefined ? 'done' : displayStatus(agent);
    if (!this.maximized) this.place(model.rect);
    setText(this.number, model.number === undefined ? '' : `[${model.number}]`);
    this.number.hidden = model.number === undefined;
    setText(this.name, agent.name);
    setText(this.role, model.isOrchestrator ? t('pro.term.main') : agentRole(agent));
    this.codex.hidden = !isCodex(agent);
    this.account.hidden = isCodex(agent);
    if (!isCodex(agent)) this.renderAccount(model.account);
    const shortName = agent.model === undefined ? '' : shortModel(agent.model);
    setText(this.model, shortName);
    setAttr(this.model, 'title', agent.model ?? null);
    this.model.hidden = shortName === '';
    setLive(this.elapsed, 'elapsed', agent.startedAt);
    setAttr(this.elapsed, 'title', t('pro.node.session'));
    const title = agentTitle(agent);
    setText(this.task, title ?? '');
    setAttr(this.task, 'title', title ?? null);
    this.task.hidden = title === undefined || title === '';
    this.updateStatus(status, model.finishedAt ?? agent.statusSince);
    setAttr(
      this.el,
      'aria-label',
      t('pro.node.label', { name: agent.name, role: this.role.textContent ?? '', status: statusLabel(status) }),
    );
    for (const state of ['working', 'waiting', 'shell', 'idle', 'done', 'error', 'offline'] as const)
      toggleClass(this.el, `is-${state}`, status === state);
    toggleClass(this.el, 'is-orchestrator', model.isOrchestrator);
    toggleClass(this.el, 'is-sub', !model.isOrchestrator);
    toggleClass(this.el, 'is-finished', model.finishedAt !== undefined);
    toggleClass(this.el, 'is-selected', model.selected);
    this.setMaximizedState(model.maximized);
    this.renderPill(model);
    this.syncXterm(model.finishedAt === undefined ? agent.terminalId : undefined);
    this.renderAsk(agent, status === 'waiting', model.finishedAt !== undefined);
    if (agent.lastEventAt !== this.lastEventAt) {
      // The office saw it do something: a live terminal reads it now, a resting one shows the new activity.
      this.lastEventAt = agent.lastEventAt;
      if (this.detail === 'live') this.liveFeed.nudge();
    }
    if (this.detail === 'live' && this.liveFeed.state.loaded) return;
    if (this.detail === 'live') this.renderBody();
    else this.renderResting();
  }

  /** Redraws a resting terminal now, or once the redraw interval has passed. */
  private renderResting(): void {
    if (this.restingTimer !== null) return;
    const wait = this.lastRestingDraw + RESTING_REDRAW_MS - performance.now();
    if (wait <= 0) {
      this.renderBody();
      return;
    }
    this.restingTimer = setTimeout(() => {
      this.restingTimer = null;
      if (this.detail === 'summary') this.renderBody();
    }, wait);
  }

  private place(rect: Rect): void {
    this.el.style.width = `${rect.width}px`;
    this.el.style.height = `${rect.height}px`;
    this.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
  }

  private updateStatus(status: ReturnType<typeof displayStatus>, since: number): void {
    const line = statusLine(status);
    setText(this.statusGlyph, line.glyph);
    setText(this.statusText, line.text);
    this.status.className = `ao-pro-status tone-${line.tone}`;
    this.statusTime.hidden = !line.timed;
    setLive(this.statusTime, 'elapsed', since);
  }

  /** `[P]`: the account as plain text (its name in the tooltip). */
  private renderAccount(account: Account | undefined): void {
    setText(this.account, `[${account ? accountInitial(account) : '?'}]`);
    setAttr(
      this.account,
      'title',
      account ? t('account.chip', { label: accountLabel(account) }) : t('account.unknown'),
    );
  }

  /** The permission prompt (with its answer buttons) or the question the agent is waiting on, as the CLI shows it. */
  private renderAsk(agent: Agent, waiting: boolean, finished: boolean): void {
    const shown = this.ask.update(agent, waiting, finished);
    if (shown === this.asking) return;
    this.asking = shown;
    this.placeAsk();
  }

  /** Under the conversation, or under the real terminal when it is on screen. */
  private placeAsk(): void {
    const inSlot = this.asking && this.xterm !== null && this.xtermOnScreen();
    this.body.setTail(this.asking && !inSlot ? this.ask.el : null);
    this.askSlot.hidden = !inSlot;
    if (inSlot) this.askSlot.replaceChildren(this.ask.el);
    else this.askSlot.replaceChildren();
  }

  // --- real terminal --------------------------------------------------------------------------------------------

  private xtermOnScreen(): boolean {
    return this.xtermId !== null && (this.detail === 'live' || this.maximized);
  }

  /** A session the office opened shows the program itself; when it scrolls off, the transcript takes over. */
  private syncXterm(terminalId: string | undefined): void {
    if (terminalId !== this.xtermId) {
      this.xterm?.dispose();
      this.xterm?.el.remove();
      this.xterm = null;
      this.xtermId = terminalId ?? null;
      this.killButton.hidden = terminalId === undefined;
    }
    const onScreen = this.xtermOnScreen();
    if (onScreen && this.xterm === null && this.xtermId !== null) {
      this.xterm = this.handlers.openXterm(
        this.xtermId,
        () => this.el.focus({ preventScroll: true }),
        (focused) => {
          this.typing.hidden = !focused;
        },
      );
      this.content.insertBefore(this.xterm.el, this.askSlot);
    }
    if (this.xterm !== null && this.wantsTerminalFocus) {
      this.wantsTerminalFocus = false;
      this.xterm.focus();
    }
    toggleClass(this.el, 'has-xterm', onScreen);
    this.placeAsk();
  }

  /** Gives the program the keyboard as soon as its terminal is on screen. */
  focusTerminal(): void {
    this.wantsTerminalFocus = true;
    this.syncXterm(this.xtermId ?? undefined);
  }

  private onKillClick(): void {
    const id = this.xtermId;
    if (id === null) return;
    if (this.killArmed === null) {
      toggleClass(this.killButton, 'is-armed', true);
      setAttr(this.killButton, 'title', t('pro.terminal.killConfirm'));
      setAttr(this.killButton, 'aria-label', t('pro.terminal.killConfirm'));
      this.killArmed = setTimeout(() => this.disarmKill(), KILL_CONFIRM_MS);
      return;
    }
    this.disarmKill();
    this.handlers.killTerminal(id);
  }

  private disarmKill(): void {
    if (this.killArmed !== null) clearTimeout(this.killArmed);
    this.killArmed = null;
    toggleClass(this.killButton, 'is-armed', false);
    setAttr(this.killButton, 'title', t('pro.terminal.kill'));
    setAttr(this.killButton, 'aria-label', t('pro.terminal.kill'));
  }

  // --- detail and text --------------------------------------------------------------------------------------------

  /** How much this terminal reads and how often it polls (decided by the policy). */
  setDetail(detail: Detail, pollMs: number): void {
    const was = this.detail;
    this.detail = detail;
    toggleClass(this.el, 'is-off', detail === 'hidden');
    toggleClass(this.el, 'lod-summary', detail === 'summary');
    toggleClass(this.el, 'lod-live', detail === 'live');
    if (detail === 'live') this.liveFeed.run(pollMs);
    else if (was === 'live') this.liveFeed.stop();
    if (detail !== was) {
      this.configureBody();
      this.renderBody();
      this.syncXterm(this.xtermId ?? undefined);
    }
  }

  private configureBody(): void {
    const size = this.maximized ? WINDOW_MAXIMIZED : this.detail === 'live' ? WINDOW_ENTRIES : WINDOW_RECENT;
    this.body.configure(size, this.maximized ? RESULT_LINES_MAXIMIZED : RESULT_LINES);
  }

  /** What the terminal shows: the transcript it read, followed by what the office saw the agent do since. */
  private currentEntries(agent: Agent): readonly TranscriptEntry[] {
    const recent = this.recent.entries(agent, agent.recent, {
      pendingLast: agent.status === 'working' && this.model_?.finishedAt === undefined,
      result: agent.demo === true ? demoResult : NO_RESULT,
    });
    const feed = this.liveFeed.state;
    if (!feed.loaded) return recent;
    return this.detail === 'live' ? feed.entries : withNewer(feed.entries, recent);
  }

  private renderBody(): void {
    const model = this.model_;
    if (model === null || this.detail === 'hidden') return;
    if (this.detail === 'summary') this.lastRestingDraw = performance.now();
    const feed = this.liveFeed;
    const failed = feed.status === 'error';
    this.retry.hidden = !failed || this.detail !== 'live';
    this.body.setNote(failed && this.detail === 'live' ? describeError(feed.error) : null);
    this.body.update(this.currentEntries(model.agent));
  }

  /** Stops its polling (the terminal left the canvas, or the page rebuilds its panels). */
  dispose(): void {
    this.liveFeed.stop();
    this.xterm?.dispose();
    this.disarmKill();
    if (this.restingTimer !== null) clearTimeout(this.restingTimer);
    this.restingTimer = null;
  }

  rememberScroll(): void {
    this.body.rememberScroll();
  }

  restoreScroll(): void {
    this.body.restoreScroll();
  }

  // --- maximize ---------------------------------------------------------------------------------------------------

  private setMaximizedState(maximized: boolean): void {
    if (maximized === this.maximized) return;
    this.maximized = maximized;
    toggleClass(this.el, 'is-maximized', maximized);
    if (!maximized && this.model_ !== null) this.place(this.model_.rect);
    this.maximizeButton.replaceChildren(icon(maximized ? 'minimize' : 'maximize', 13));
    const label = t(maximized ? 'pro.node.restore' : 'pro.node.maximize');
    this.maximizeButton.setAttribute('aria-label', label);
    this.maximizeButton.title = label;
    this.configureBody();
  }

  // --- finished subagents (orchestrators) ---------------------------------------------------------------------------

  private renderPill(model: NodeModel): void {
    const count = model.collapsed.length;
    this.pill.hidden = !model.isOrchestrator || count === 0;
    if (!model.isOrchestrator) return;
    if (count === 0) this.doneOpen = false;
    setText(this.pill, t('pro.node.done', { n: count }));
    this.pill.setAttribute('aria-expanded', String(this.doneOpen));
    this.renderDone();
  }

  private renderDone(): void {
    const model = this.model_;
    this.doneList.hidden = !this.doneOpen || model === null;
    if (!this.doneOpen || model === null) return;
    const signature = model.collapsed.map((entry) => entry.agent.id).join('|');
    if (signature === this.doneSignature) return;
    this.doneSignature = signature;
    this.doneList.replaceChildren(
      h('p', { class: 'ao-pro-done-title' }, t('pro.node.doneTitle', { n: model.collapsed.length })),
      ...model.collapsed.map((entry) =>
        h(
          'button',
          {
            type: 'button',
            class: 'ao-pro-done-item',
            'data-no-drag': '',
            onclick: () => this.handlers.openFinished(entry.agent),
          },
          h('span', { class: 'ao-pro-done-mark', 'aria-hidden': 'true' }, '✓'),
          h('span', { class: 'ao-pro-done-type' }, agentRole(entry.agent)),
          h('span', { class: 'ao-pro-done-task' }, agentTitle(entry.agent) ?? entry.agent.name),
        ),
      ),
    );
  }
}
