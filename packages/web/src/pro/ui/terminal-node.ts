// One terminal window of the canvas: title bar (who, role, account, status, time), the live conversation, and the
// last activity line. At a zoom where it cannot be read it turns into a card with the name and what it is doing.
import { isCodex, type Account, type Agent, type TranscriptEntry } from '@ai-office/shared';
import { describeError } from '../../net/backend';
import { t, type TextKey } from '../../i18n';
import { activityText, agentRole, agentTitle, agentWaitingFor, permissionSummary } from '../../ui/display';
import { h, setAttr, setText, toggleClass } from '../../ui/dom';
import { icon, type IconName } from '../../ui/icons';
import { displayStatus, statusLabel, type DisplayStatus } from '../../ui/model/status';
import { liveText, setLive, setStatusDot, statusDot, updateAccountChip } from '../../ui/widgets';
import type { Rect } from '../model/geometry';
import { WINDOW_ENTRIES, WINDOW_MAXIMIZED } from '../model/live-transcript';
import type { Detail } from '../model/policy';
import type { FinishedSub } from '../model/scene';
import { TranscriptBody } from './transcript-body';
import { TranscriptFeed, type FeedSource } from './transcript-feed';

export interface NodeModel {
  agent: Agent;
  rect: Rect;
  isOrchestrator: boolean;
  roomName: string;
  account: Account | undefined;
  /** When it finished (faded subagents). */
  finishedAt: number | undefined;
  selected: boolean;
  maximized: boolean;
  /** Finished subagents folded into the orchestrator's pill. */
  collapsed: readonly FinishedSub[];
  now: number;
}

export interface NodeHandlers {
  maximize(): void;
  openInTerminal(): void;
  showInOffice(): void;
  copySessionId(): void;
  select(): void;
  openFinished(agent: Agent): void;
}

type ActionName = 'maximize' | 'terminal' | 'office' | 'copy';

const ACTIONS: readonly { name: ActionName; icon: IconName; key: TextKey }[] = [
  { name: 'maximize', icon: 'maximize', key: 'pro.node.maximize' },
  { name: 'terminal', icon: 'terminal', key: 'pro.node.openTerminal' },
  { name: 'office', icon: 'target', key: 'pro.node.showOffice' },
  { name: 'copy', icon: 'copy', key: 'pro.node.copyId' },
];

export class TerminalNode {
  readonly el = h('article', { class: 'ao-pro-node', tabindex: '0', role: 'group' });
  private readonly dot = statusDot('idle');
  private readonly name = h('strong', { class: 'ao-pro-name' });
  private readonly role = h('span', { class: 'ao-pro-role' });
  private readonly account = h('span', { class: 'ao-account' });
  private readonly codex = h(
    'span',
    { class: 'ao-source-badge', hidden: true, title: t('codex.badge.title') },
    t('codex.badge'),
  );
  private readonly elapsed = liveText('elapsed', 0, 'ao-pro-elapsed');
  private readonly task = h('p', { class: 'ao-pro-task' });
  private readonly body: TranscriptBody;
  private readonly toEnd: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private readonly cardName = h('strong', { class: 'ao-pro-card-name' });
  private readonly cardStatus = h('span', { class: 'ao-pro-card-status' });
  private readonly cardLine = h('p', { class: 'ao-pro-card-line' });
  private readonly foot = h('footer', { class: 'ao-pro-foot' });
  private readonly pill = h('button', { type: 'button', class: 'ao-pro-pill', hidden: true });
  private readonly doneList = h('div', { class: 'ao-pro-done', hidden: true });
  private readonly maximizeButton: HTMLButtonElement;
  private readonly liveFeed: TranscriptFeed;
  private detail: Detail = 'summary';
  private maximized = false;
  private doneOpen = false;
  private doneSignature = '';
  private model: NodeModel | null = null;
  private lastEntries: readonly TranscriptEntry[] | null = null;
  private lastFeedStatus = '';

  constructor(
    readonly id: string,
    source: FeedSource,
    private readonly handlers: NodeHandlers,
    private readonly onDirty: () => void,
  ) {
    this.liveFeed = new TranscriptFeed(source, () => this.renderBody());
    this.body = new TranscriptBody((sticking) => {
      this.toEnd.hidden = sticking;
    });
    this.toEnd = h(
      'button',
      {
        type: 'button',
        class: 'ao-btn ao-btn--soft ao-btn--small ao-pro-end',
        hidden: true,
        onclick: () => this.body.scrollToEnd(),
      },
      icon('arrowDown', 14),
      h('span', null, t('terminal.toEnd')),
    );
    this.retry = h(
      'button',
      {
        type: 'button',
        class: 'ao-btn ao-btn--soft ao-btn--small ao-pro-retry',
        hidden: true,
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
    this.pill.addEventListener('click', () => {
      this.doneOpen = !this.doneOpen;
      this.doneSignature = '';
      this.renderDone();
    });
    this.el.append(
      h(
        'header',
        { class: 'ao-pro-head', 'data-drag': '' },
        this.dot,
        h('div', { class: 'ao-pro-heading' }, this.name, this.role),
        this.codex,
        this.account,
        this.elapsed,
        h('div', { class: 'ao-pro-actions' }, ...buttons),
      ),
      this.task,
      h(
        'div',
        { class: 'ao-pro-content' },
        this.body.el,
        h('div', { class: 'ao-pro-card' }, this.cardStatus, this.cardName, this.cardLine),
        this.toEnd,
        this.retry,
        this.doneList,
      ),
      h('div', { class: 'ao-pro-foot-row' }, this.foot, this.pill),
    );
    this.el.addEventListener('pointerdown', () => this.handlers.select());
    this.el.addEventListener('focusin', () => toggleClass(this.el, 'is-focused', true));
    this.el.addEventListener('focusout', () => toggleClass(this.el, 'is-focused', false));
  }

  private actionButton(action: (typeof ACTIONS)[number]): HTMLButtonElement {
    const button = h(
      'button',
      {
        type: 'button',
        class: 'ao-iconbtn ao-iconbtn--small ao-pro-action',
        'aria-label': t(action.key),
        title: t(action.key),
        'data-no-drag': '',
      },
      icon(action.icon, 14),
    );
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      switch (action.name) {
        case 'maximize':
          this.handlers.maximize();
          break;
        case 'terminal':
          this.handlers.openInTerminal();
          break;
        case 'office':
          this.handlers.showInOffice();
          break;
        case 'copy':
          this.handlers.copySessionId();
          break;
      }
    });
    return button;
  }

  // --- model ------------------------------------------------------------------------------------------------------

  update(model: NodeModel): void {
    this.model = model;
    const { agent } = model;
    const status = displayStatus(agent);
    const finished = model.finishedAt !== undefined;
    if (!this.maximized) {
      const { rect } = model;
      this.el.style.width = `${rect.width}px`;
      this.el.style.height = `${rect.height}px`;
      this.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    }
    setStatusDot(this.dot, status);
    setText(this.name, agent.name);
    setText(this.role, model.isOrchestrator ? roleOfMain(agent) : agentRole(agent));
    toggleClass(this.role, 'is-empty', this.role.textContent === '');
    this.codex.hidden = !isCodex(agent);
    this.account.hidden = isCodex(agent);
    updateAccountChip(this.account, model.account);
    setLive(this.elapsed, 'elapsed', agent.statusSince);
    this.elapsed.hidden = status === 'offline';
    const title = agentTitle(agent);
    setText(this.task, title ?? '');
    setAttr(this.task, 'title', title ?? null);
    this.task.hidden = title === undefined || title === '';
    this.updateCard(agent, status);
    this.updateFoot(agent, status);
    setAttr(
      this.el,
      'aria-label',
      t('pro.node.label', { name: agent.name, role: this.role.textContent ?? '', status: statusLabel(status) }),
    );
    for (const state of ['working', 'waiting', 'shell', 'idle', 'done', 'error', 'offline'] as const)
      toggleClass(this.el, `is-${state}`, status === state);
    toggleClass(this.el, 'is-orchestrator', model.isOrchestrator);
    toggleClass(this.el, 'is-sub', !model.isOrchestrator);
    toggleClass(this.el, 'is-finished', finished);
    toggleClass(this.el, 'is-selected', model.selected);
    this.setMaximizedState(model.maximized);
    this.renderPill(model);
  }

  private updateCard(agent: Agent, status: DisplayStatus): void {
    setText(this.cardName, agent.name);
    setText(this.cardStatus, statusLabel(status));
    setText(this.cardLine, this.lastLine(agent));
  }

  private updateFoot(agent: Agent, status: DisplayStatus): void {
    const line = this.lastLine(agent);
    setText(this.foot, line);
    setAttr(this.foot, 'title', line);
    toggleClass(this.foot, 'is-waiting', status === 'waiting');
  }

  private lastLine(agent: Agent): string {
    if (agent.status === 'waiting')
      return (
        (agent.permission ? permissionSummary(agent.permission) : undefined) ??
        agentWaitingFor(agent) ??
        t('sidebar.row.needsYou')
      );
    if (agent.activity) return `${agent.activity.icon} ${activityText(agent.activity)}`;
    return statusLabel(displayStatus(agent));
  }

  // --- detail and live feed ---------------------------------------------------------------------------------------

  /** How much this terminal shows and how often it polls (decided by the policy). */
  setDetail(detail: Detail, pollMs: number): void {
    const wasLive = this.detail === 'live';
    this.detail = detail;
    toggleClass(this.el, 'is-off', detail === 'hidden');
    toggleClass(this.el, 'lod-summary', detail === 'summary');
    toggleClass(this.el, 'lod-live', detail === 'live');
    if (detail === 'live') {
      if (!wasLive) {
        this.renderBody();
        this.liveFeed.run(pollMs);
      } else {
        this.liveFeed.run(pollMs);
      }
    } else if (wasLive || detail === 'hidden') {
      this.liveFeed.stop();
    }
  }

  private renderBody(): void {
    const feed = this.liveFeed;
    const showRetry = feed.status === 'error';
    this.retry.hidden = !showRetry;
    if (feed.status === 'loading' || feed.status === 'idle') {
      if (this.lastFeedStatus !== 'loading') this.body.showMessage(t('terminal.loading'), 'note');
      this.lastFeedStatus = 'loading';
    } else if (feed.status === 'error') {
      this.body.showMessage(describeError(feed.error), 'error');
      this.lastFeedStatus = 'error';
    } else if (feed.state.entries !== this.lastEntries || this.lastFeedStatus !== 'ready') {
      this.lastFeedStatus = 'ready';
      this.lastEntries = feed.state.entries;
      this.body.update(feed.state.entries);
    }
    this.onDirty();
  }

  /** Stops its polling (the terminal left the canvas, or the page rebuilds its panels). */
  dispose(): void {
    this.liveFeed.stop();
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
    if (!maximized) {
      const rect = this.model?.rect;
      if (rect !== undefined) {
        this.el.style.width = `${rect.width}px`;
        this.el.style.height = `${rect.height}px`;
        this.el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
      }
    }
    this.body.setWindow(maximized ? WINDOW_MAXIMIZED : WINDOW_ENTRIES);
    this.lastEntries = null;
    this.maximizeButton.replaceChildren(icon(maximized ? 'minimize' : 'maximize', 14));
    const label = t(maximized ? 'pro.node.restore' : 'pro.node.maximize');
    this.maximizeButton.setAttribute('aria-label', label);
    this.maximizeButton.title = label;
    if (this.detail === 'live') this.renderBody();
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
    const model = this.model;
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
          { type: 'button', class: 'ao-pro-done-item', onclick: () => this.handlers.openFinished(entry.agent) },
          h('strong', null, entry.agent.name),
          h('span', null, [agentRole(entry.agent), agentTitle(entry.agent)].filter(Boolean).join(' · ')),
        ),
      ),
    );
  }
}

/** "Principal" is not worth a label on the orchestrator: only a role the person gave it. */
function roleOfMain(agent: Agent): string {
  return agent.role && agent.role !== 'Principal' ? agentRole(agent) : t('agent.main');
}
