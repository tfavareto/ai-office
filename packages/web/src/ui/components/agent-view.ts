// Drawer content for a selected agent: hero, status row with actions, urgent cards, tabs.
import { isCodex, type Agent } from '@ai-office/shared';
import { t, type UiKey } from '../../i18n';
import { localOnlyHint, type AppContext, type Component } from '../context';
import { agentKindLabel, agentTitle } from '../display';
import { h, setText, toggleClass } from '../dom';
import { icon, type IconName } from '../icons';
import { messageBlockedBySource } from '../model/source';
import { displayStatus, statusHint, statusLabel } from '../model/status';
import type { DrawerTab } from '../state';
import {
  accountChip,
  createAvatar,
  emptyNote,
  liveText,
  setDisabled,
  setLive,
  setPressed,
  setStatusDot,
  statusDot,
  updateAccountChip,
} from '../widgets';
import { ActivityTab, DataTab, MessagesTab, SummaryTab, type AgentTab } from './agent-tabs';
import { closeButton } from './overlay';
import { PermissionCard, ShellCard, WaitingCard } from './urgent-cards';

const TABS: readonly { id: DrawerTab; label: UiKey }[] = [
  { id: 'summary', label: 'drawer.tab.summary' },
  { id: 'messages', label: 'drawer.tab.messages' },
  { id: 'activity', label: 'drawer.tab.activity' },
  { id: 'data', label: 'drawer.tab.data' },
];

interface ActionButton {
  el: HTMLButtonElement;
  label: HTMLElement;
}

export class AgentView implements Component {
  readonly el = h('div', { class: 'ao-agentview' });
  private agentId: string | null = null;
  private readonly avatar = createAvatar(56);
  private readonly dot = statusDot('idle');
  private readonly name = h('h2', { class: 'ao-hero-name', id: 'ao-drawer-title' });
  private readonly kindChip = h('span', { class: 'ao-tag' });
  private readonly sourceChip = h('span', { class: 'ao-tag ao-tag--codex', hidden: true }, t('codex.badge'));
  private readonly account = accountChip(undefined);
  private readonly roomLink = h('button', { type: 'button', class: 'ao-link ao-room-link' });
  private readonly roomName = h('span');
  private readonly title = h('p', { class: 'ao-agent-title' });
  private readonly statusText = h('span', { class: 'ao-status-text' });
  private readonly since = liveText('ago', 0, 'ao-status-since');
  private readonly statusDotEl = statusDot('idle');
  private readonly urgent = h('div', { class: 'ao-urgent-stack' });
  private readonly gone = h('div', { class: 'ao-gone', hidden: true }, emptyNote(t('agent.left')));
  private readonly body = h('div', { class: 'ao-agent-body' });
  private readonly tabButtons = new Map<DrawerTab, HTMLButtonElement>();
  private readonly tabBadges = new Map<DrawerTab, HTMLElement>();
  private readonly panels = new Map<DrawerTab, HTMLElement>();
  private readonly tabs: Record<DrawerTab, AgentTab>;
  private readonly permissionCard: PermissionCard;
  private readonly waitingCard: WaitingCard;
  private readonly shellCard: ShellCard;
  private readonly actions: Record<'message' | 'follow' | 'center' | 'terminal', ActionButton>;
  private activeTab: DrawerTab | null = null;

  constructor(private readonly ctx: AppContext) {
    this.permissionCard = new PermissionCard(ctx);
    this.waitingCard = new WaitingCard(ctx);
    this.shellCard = new ShellCard(ctx);
    this.tabs = {
      summary: new SummaryTab(ctx),
      messages: new MessagesTab(ctx),
      activity: new ActivityTab(ctx),
      data: new DataTab(ctx),
    };
    this.actions = {
      message: this.action('message', t('agent.action.message'), () => this.openMessage()),
      follow: this.action('follow', t('agent.action.follow'), () => ctx.toggleFollow()),
      center: this.action('target', t('agent.action.center'), () => ctx.world.focusSelection()),
      terminal: this.action('terminal', t('agent.action.terminal'), () => this.toggleTerminal()),
    };
    this.roomLink.append(icon('folder', 14), this.roomName);
    this.roomLink.addEventListener(
      'click',
      () => this.agentId && ctx.selectRoom(this.ctx.agent(this.agentId)?.projectId ?? '', { focus: true }),
    );

    const hero = h(
      'header',
      { class: 'ao-hero' },
      h('div', { class: 'ao-hero-avatar' }, this.avatar.el, this.dot),
      h(
        'div',
        { class: 'ao-hero-info' },
        this.name,
        h('div', { class: 'ao-hero-tags' }, this.kindChip, this.sourceChip, this.account),
        this.roomLink,
      ),
      closeButton(t('drawer.close'), () => ctx.clearSelection()),
    );
    const statusRow = h(
      'div',
      { class: 'ao-status-row' },
      h('div', { class: 'ao-status-info' }, this.statusDotEl, this.statusText, this.since),
      h('div', { class: 'ao-actions' }, ...Object.values(this.actions).map((a) => a.el)),
    );
    const tablist = h('div', { class: 'ao-tabs', role: 'tablist', 'aria-label': t('drawer.tabs') });
    for (const tab of TABS) {
      const badge = h('span', { class: 'ao-tab-badge', hidden: true });
      const btn = h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: `ao-tab-${tab.id}`,
          'aria-controls': `ao-panel-${tab.id}`,
          class: 'ao-tab',
          onclick: () => ctx.ui.set({ drawerTab: tab.id }),
        },
        h('span', null, t(tab.label)),
        badge,
      );
      this.tabButtons.set(tab.id, btn);
      this.tabBadges.set(tab.id, badge);
      tablist.appendChild(btn);
      const panel = h(
        'div',
        {
          class: 'ao-tabpanel',
          role: 'tabpanel',
          id: `ao-panel-${tab.id}`,
          'aria-labelledby': `ao-tab-${tab.id}`,
          tabindex: '0',
          hidden: true,
        },
        this.tabs[tab.id].el,
      );
      this.panels.set(tab.id, panel);
    }
    tablist.addEventListener('keydown', (event) => this.onTabKey(event));
    this.urgent.append(this.permissionCard.el, this.waitingCard.el, this.shellCard.el);
    this.body.append(this.title, statusRow, this.urgent, tablist, ...this.panels.values());
    this.el.append(hero, this.body, this.gone);
  }

  private action(name: IconName, label: string, onClick: () => void): ActionButton {
    const text = h('span', null, label);
    const el = h(
      'button',
      {
        type: 'button',
        class: 'ao-btn ao-btn--soft ao-action',
        'aria-pressed': 'false',
        title: label,
        'data-base-title': label,
        onclick: onClick,
      },
      icon(name, 15),
      text,
    );
    return { el, label: text };
  }

  setAgent(id: string): void {
    if (this.agentId === id) return;
    this.agentId = id;
    this.activeTab = null;
  }

  /** The drawer shows something else: stop polling for this agent. */
  deactivate(): void {
    if (this.activeTab) this.tabs[this.activeTab].setActive?.(false);
    this.activeTab = null;
    this.agentId = null;
  }

  private openMessage(): void {
    const ui = this.ctx.ui.get();
    this.ctx.ui.set({ drawerTab: 'messages', composerFocus: ui.composerFocus + 1 });
  }

  private toggleTerminal(): void {
    const agent = this.agentId ? this.ctx.agent(this.agentId) : undefined;
    if (!agent) return;
    const target = this.ctx.ui.get().terminal;
    if (target && target.officeAgentId === agent.id) this.ctx.closeTerminal();
    else this.ctx.openTerminalForAgent(agent);
  }

  private onTabKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = TABS.findIndex((t) => t.id === this.ctx.ui.get().drawerTab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    this.ctx.ui.set({ drawerTab: next.id });
    this.tabButtons.get(next.id)?.focus();
  }

  render(): void {
    const agent = this.agentId ? this.ctx.agent(this.agentId) : undefined;
    this.body.hidden = !agent;
    this.gone.hidden = agent !== undefined;
    if (!agent) return;
    this.renderHero(agent);
    this.renderStatus(agent);
    this.renderUrgent(agent);
    this.renderTabs(agent);
  }

  private renderHero(agent: Agent): void {
    const ds = displayStatus(agent);
    this.avatar.update(agent, this.ctx.world.portrait(agent.id, 112));
    setStatusDot(this.dot, ds);
    setText(this.name, agent.name);
    setText(this.kindChip, agentKindLabel(agent));
    this.sourceChip.hidden = !isCodex(agent);
    this.sourceChip.title = t('codex.badge.title');
    updateAccountChip(this.account, this.ctx.account(agent.accountId), true);
    // The Codex tag already says which account this is.
    this.account.hidden = isCodex(agent);
    setText(this.roomName, this.ctx.project(agent.projectId)?.name ?? t('agent.room'));
    const title = agentTitle(agent);
    this.title.hidden = !title;
    setText(this.title, title ?? '');
  }

  private renderStatus(agent: Agent): void {
    const ds = displayStatus(agent);
    setStatusDot(this.statusDotEl, ds);
    setText(this.statusText, statusLabel(ds));
    this.statusText.title = statusHint(ds);
    this.statusText.className = `ao-status-text ao-text--${ds}`;
    setLive(this.since, 'ago', agent.statusSince);

    const local = this.ctx.isLocal;
    const live = ds !== 'offline' && ds !== 'done';
    const readOnly = messageBlockedBySource(agent);
    setDisabled(
      this.actions.message.el,
      !local || !live || readOnly !== null,
      !local ? localOnlyHint() : (readOnly ?? t('agent.gone')),
    );
    setDisabled(this.actions.terminal.el, !local, localOnlyHint());
    const ui = this.ctx.ui.get();
    setPressed(this.actions.follow.el, ui.following);
    setPressed(this.actions.terminal.el, ui.terminal?.officeAgentId === agent.id);
  }

  private renderUrgent(agent: Agent): void {
    const permission = agent.permission;
    const waiting = !permission && agent.status === 'waiting';
    const shell = displayStatus(agent) === 'shell' && agent.shells.length > 0;
    this.permissionCard.el.hidden = !permission;
    this.waitingCard.el.hidden = !waiting;
    this.shellCard.el.hidden = !shell;
    this.urgent.hidden = !permission && !waiting && !shell;
    if (permission) this.permissionCard.update(agent, permission);
    if (waiting) this.waitingCard.update(agent);
    if (shell) this.shellCard.update(agent);
  }

  private renderTabs(agent: Agent): void {
    const active = this.ctx.ui.get().drawerTab;
    for (const tab of TABS) {
      const on = tab.id === active;
      const btn = this.tabButtons.get(tab.id);
      const panel = this.panels.get(tab.id);
      if (!btn || !panel) continue;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      toggleClass(btn, 'is-on', on);
      panel.hidden = !on;
    }
    const shellBadge = this.tabBadges.get('activity');
    if (shellBadge) {
      shellBadge.hidden = agent.shells.length === 0;
      setText(shellBadge, String(agent.shells.length));
    }
    if (active !== this.activeTab) {
      if (this.activeTab) this.tabs[this.activeTab].setActive?.(false);
      this.activeTab = active;
      this.tabs[active].setActive?.(true);
    }
    this.tabs[active].update(agent);
  }
}
