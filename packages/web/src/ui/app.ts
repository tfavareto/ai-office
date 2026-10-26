// Application shell: owns the stores, builds the panels, batches rendering per animation frame and wires the world.
import {
  DECOR_LEVELS,
  suggestRule,
  type Account,
  type Agent,
  type BossMessage,
  type FeedItem,
  type CodexSettings,
  type GitSettings,
  type HireRequest,
  type Msg,
  type Notice,
  type NoticeLevel,
  type OfficeSnapshot,
  type PendingHire,
  type PermissionDecision,
  type ProgressEventName,
  type ProgressSummary,
  type PermissionRequest,
  type Project,
  type RecentSession,
  isTeamId,
} from '@ai-office/shared';
import { locale, onLocaleChange, t, tm } from '../i18n';
import { describeError } from '../net/backend';
import { buildChanged } from '../net/reducers';
import type { Store } from '../net/store';
import { toWorldOptions, type PrefsStore } from '../prefs/prefs';
import type { Selection } from '../world/api';
import { notifyPermission, showBrowserNotification } from './browser-notify';
import { AchievementsDialog } from './components/achievements-dialog';
import { BoardDialog } from './components/board-dialog';
import { celebrate } from './components/celebrate';
import { Drawer } from './components/drawer';
import { RulesDialog } from './components/rules-dialog';
import { ShareDialog } from './components/share-dialog';
import { DayDialog } from './components/day-dialog';
import { ReplayBadge, ReplayBar } from './components/replay-bar';
import { EmptyState } from './components/empty-state';
import { Feed } from './components/feed';
import { HelpDialog } from './components/help-dialog';
import { HireDialog } from './components/hire-dialog';
import { HoverTip } from './components/hover-tip';
import { InboxPopover } from './components/inbox-popover';
import { NotificationCenter } from './components/notification-center';
import { SessionHistory } from './components/session-history';
import { FOCUS_KEY_ATTR, Settings } from './components/settings';
import { UsageDialog } from './components/usage-dialog';
import { UsagePopover } from './components/usage-popover';
import { Sidebar } from './components/sidebar';
import { ConnectionBanner, Splash } from './components/splash';
import { TerminalPanel } from './components/terminal-panel';
import { Toasts } from './components/toasts';
import { TopBar } from './components/topbar';
import { localOnlyHint, setReplayHint, type AppContext, type Component } from './context';
import { BoardStore } from './board-store';
import { bindFeedDismiss } from './feed-dismiss';
import { bindLanguage } from './language';
import { accountLabel, agentRole, agentTitle, localized, localizedOptional, permissionSummary } from './display';
import { h, isEditable, toggleClass } from './dom';
import { formatClock, formatDateKey, toDateKey } from './format';
import { computeInsets, layoutVariables, sameInsets } from './layout';
import { InboxController } from './inbox-controller';
import { BIG_SKIP_MS, SKIP_MS } from '../timelapse/clock';
import { ReplayController } from './replay-controller';
import { ProgressController } from './progress-controller';
import { announcements, loadSeen, saveSeen, type Seen } from './model/progress-seen';
import { achievementNameKey, decorNameKey, levelTitleKey } from './model/progress-view';
import { RulesController, type RulesTab } from './rules-controller';
import { CustomizationController } from './customization-controller';
import { CustomizeDialog } from './components/customize-dialog';
import { TeamDialog } from './components/team-dialog';
import { TeamController } from './team-controller';
import { EMPTY_OVERLAY, firstTeamOrder, teamOverlay, withTeam, type TeamFilter, type TeamOverlay } from './model/team';
import { MessageCenter } from './message-center';
import { agentsWithPermission, agentsWithShells, computeCounters, nextAfter } from './model/counters';
import type { HireTarget } from './model/hire';
import { takeFreshAlerts, usageAlerts } from './model/usage-forecast';
import { shouldInterrupt } from './model/notifications';
import { NotificationsStore, ToastStore } from './notification-stores';
import { resolveShortcut, type ShortcutAction } from './shortcuts';
import { SoundPlayer, type CueKind } from './sound';
import { onCelebration } from '../world/celebration-bus';
import {
  NARROW_BREAKPOINT,
  UiState,
  initialUiData,
  type DayTab,
  type CustomizeTarget,
  type DialogId,
  type DrawerTab,
  type PopoverId,
  type TerminalTarget,
} from './state';
import { tickLive } from './widgets';
import type { WorldHost } from './world-host';
import type { ViewInsets } from '../world/api';

const CLOCK_MS = 1000;
const NBSP = String.fromCharCode(160);
const RELOAD_GUARD_KEY = 'ai-office:reload-at';
const RELOAD_GUARD_MS = 15_000;

/** Scrollable panels whose position survives the rebuild after a language change. */
const SCROLL_SELECTORS = [
  '.ao-sidebar-list',
  '.ao-agent-body',
  '.ao-feed-list',
  '.ao-settings-body',
  '.ao-help-body',
  '.ao-sessions-body',
  '.ao-notif-list',
  '.ao-inbox-list',
] as const;

/** What acts on live sessions or reads live data: it explains itself instead of running while a time-lapse is on. */
const LIVE_ONLY_ACTIONS: ReadonlySet<ShortcutAction> = new Set([
  'inbox',
  'permission',
  'usage',
  'hire',
  'message',
  'terminal',
]);

const CUE_BY_LEVEL: Record<NoticeLevel, CueKind> = { alert: 'alert', warn: 'info', info: 'info', success: 'success' };

export class App implements AppContext {
  readonly ui: UiState;
  readonly notifications = new NotificationsStore();
  readonly toasts = new ToastStore();
  readonly messages: MessageCenter;
  readonly board = new BoardStore();
  readonly inbox: InboxController;
  readonly rules: RulesController;
  readonly customization: CustomizationController;
  readonly team: TeamController;
  readonly replay: ReplayController;
  readonly progress: ProgressController;
  private seen: Seen | null = loadSeen();
  private readonly sound = new SoundPlayer();
  private readonly root: HTMLElement;
  private components: Component[] = [];
  private sidebar!: Sidebar;
  private terminal!: TerminalPanel;
  private hoverTip!: HoverTip;
  private readonly worldContainer: HTMLElement;
  private readonly scrim = h('div', { class: 'ao-scrim ao-panel-scrim' });
  private readonly liveRegion = h('div', {
    class: 'ao-visually-hidden',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });
  private frame = 0;
  private pendingSnapshot: OfficeSnapshot | null = null;
  private appliedInsets: ViewInsets | null = null;
  private appliedFollow: boolean | null = null;
  private appliedHire: boolean | null = null;
  private lastTitle = '';
  private lastNeeds = 0;
  private buildId: string | undefined;
  private usageAlertsSeen: ReadonlySet<string> = new Set();
  private mergedMemo:
    { snapshot: OfficeSnapshot; overlay: TeamOverlay; filter: TeamFilter; value: OfficeSnapshot } | undefined;
  private overlayMemo: { key: string; snapshot: OfficeSnapshot; value: TeamOverlay } | undefined;
  private localId = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    host: HTMLElement,
    readonly store: Store,
    readonly prefs: PrefsStore,
    readonly world: WorldHost,
    worldContainer: HTMLElement,
  ) {
    this.root = host;
    this.worldContainer = worldContainer;
    const narrow = window.innerWidth < NARROW_BREAKPOINT;
    const initial = prefs.get();
    this.ui = new UiState(initialUiData({ sidebarOpen: initial.sidebarOpen, feedOpen: initial.feedOpen, narrow }));
    this.notifications.setDnd(initial.dnd);
    this.rules = new RulesController(() => this.store.backend);
    this.customization = new CustomizationController(() => this.store.backend);
    this.team = new TeamController(() => this.store.backend);
    this.progress = new ProgressController(() => this.store.backend);
    // The inbox is about the live office, whatever the panels show.
    this.inbox = new InboxController({
      snapshot: () => this.liveSnapshot,
      notifications: () => this.notifications.get().items,
      now: () => this.store.now(),
    });
    this.replay = new ReplayController({
      backend: () => this.store.backend,
      account: () => {
        const filter = this.ui.get().accountFilter;
        return filter.length === 1 ? (filter[0] as string) : 'all';
      },
      base: () => ({ accounts: this.store.snapshot?.accounts ?? [], meta: this.store.snapshot?.meta }),
      present: (snapshot, at, jump) => this.presentReplay(snapshot, at, jump),
      render: () => this.refresh(),
      frame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
    });
    this.messages = new MessageCenter({
      backend: store.backend,
      nameOf: (id) => this.liveSnapshot?.agents.find((agent) => agent.id === id)?.name ?? t('agent.fallback'),
      now: () => this.store.now(),
      onDelivery: (summary, agentId, final) => {
        this.notifications.upsertGrouped({
          key: summary.key,
          at: this.now(),
          level: summary.level,
          kind: 'message',
          text: summary.text,
          agentId,
        });
        if (final) this.flash(summary.level, summary.text, { agentId });
        if (final && shouldInterrupt(this.notifications.get(), summary.level)) this.cue(CUE_BY_LEVEL[summary.level]);
      },
    });

    for (const [key, value] of Object.entries(layoutVariables())) host.style.setProperty(key, value);
    host.classList.add('ao-root');
    this.buildShell();
    document.documentElement.lang = locale();
    this.updateDocumentMeta();
    this.wire();
  }

  // --- shell ---------------------------------------------------------------------------------------------------------

  /**
   * Builds every panel in the current language and puts them around the world container. Components write their
   * texts when they are created, so a language change calls this again: the world renderer, the stores, the
   * selection and the open panels (they live in `ui`) are kept; only the DOM of the panels is replaced.
   */
  private buildShell(): void {
    for (const component of this.components) component.dispose?.();
    this.sidebar = new Sidebar(this);
    this.terminal = new TerminalPanel(this);
    this.hoverTip = new HoverTip(this);
    const topbar = new TopBar(this);
    const drawer = new Drawer(this);
    const feed = new Feed(this);
    const toasts = new Toasts(this);
    const popovers = [
      new NotificationCenter(this),
      new InboxPopover(this),
      new SessionHistory(this),
      new Settings(this),
      new UsagePopover(this),
    ];
    const dialogs = [
      new DayDialog(this),
      new UsageDialog(this),
      new BoardDialog(this),
      new HelpDialog(this),
      new HireDialog(this),
      new RulesDialog(this),
      new ShareDialog(this),
      new CustomizeDialog(this),
      new TeamDialog(this),
      new AchievementsDialog(this),
    ];
    const empty = new EmptyState(this);
    const replayBar = new ReplayBar(this);
    const replayBadge = new ReplayBadge(this);
    const banner = new ConnectionBanner(this);
    const splash = this.snapshot === null ? new Splash(this) : null;
    this.components = [
      topbar,
      this.sidebar,
      drawer,
      this.terminal,
      feed,
      replayBar,
      replayBadge,
      toasts,
      ...popovers,
      ...dialogs,
      empty,
      banner,
      ...(splash ? [splash] : []),
    ];

    for (const child of Array.from(this.root.children)) if (child !== this.worldContainer) child.remove();
    if (this.worldContainer.parentElement !== this.root) this.root.prepend(this.worldContainer);
    this.root.append(
      topbar.el,
      banner.el,
      this.sidebar.el,
      drawer.el,
      this.terminal.el,
      feed.el,
      replayBar.el,
      replayBadge.el,
      toasts.el,
      empty.el,
      this.scrim,
      ...popovers.map((p) => p.el),
      ...dialogs.map((d) => d.el),
      this.hoverTip.el,
      ...(splash ? [splash.el] : []),
      this.liveRegion,
    );
  }

  /** Language changed: rebuild the panels in it and tell the world renderer (labels it draws itself). */
  private onLocaleChanged(): void {
    document.documentElement.lang = locale();
    this.updateDocumentMeta();
    this.world.setOptions({ locale: locale() });
    const focusKey =
      document.activeElement instanceof HTMLElement ? document.activeElement.getAttribute(FOCUS_KEY_ATTR) : null;
    const scrolls = SCROLL_SELECTORS.map((selector) =>
      Array.from(this.root.querySelectorAll<HTMLElement>(selector), (el) => el.scrollTop),
    );
    this.buildShell();
    this.lastTitle = '';
    this.renderAll();
    SCROLL_SELECTORS.forEach((selector, index) => {
      this.root.querySelectorAll<HTMLElement>(selector).forEach((el, position) => {
        el.scrollTop = scrolls[index]?.[position] ?? 0;
      });
    });
    // The popover moves focus to itself when it opens (microtask); give it back to the control the user was using.
    if (focusKey)
      queueMicrotask(() =>
        this.root.querySelector<HTMLElement>(`[${FOCUS_KEY_ATTR}="${focusKey}"]`)?.focus({ preventScroll: true }),
      );
  }

  private updateDocumentMeta(): void {
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('app.description'));
  }

  // --- AppContext: data ----------------------------------------------------------------------------------------------

  get snapshot(): OfficeSnapshot | null {
    return this.replay.engaged && this.replay.snapshot !== null ? this.replay.snapshot : this.store.snapshot;
  }

  get liveSnapshot(): OfficeSnapshot | null {
    return this.store.snapshot;
  }

  /** A time-lapse only looks: nothing that acts on a live session works while it is on. */
  get isLocal(): boolean {
    return this.store.isLocal && !this.replay.engaged;
  }

  /** The time the panels live in: the replay's while a time-lapse is on. */
  now(): number {
    return this.replay.engaged ? (this.replay.clock?.t ?? this.store.now()) : this.store.now();
  }

  feed(): readonly FeedItem[] {
    return this.replay.engaged && this.replay.snapshot !== null ? this.replay.feed() : this.store.data.feed;
  }

  agent(id: string): Agent | undefined {
    if (isTeamId(id)) return this.teamOverlay.agents.find((agent) => agent.id === id);
    return this.snapshot?.agents.find((agent) => agent.id === id);
  }

  account(id: string): Account | undefined {
    if (isTeamId(id)) return this.teamOverlay.accounts.find((account) => account.id === id);
    return this.snapshot?.accounts.find((account) => account.id === id);
  }

  project(id: string): Project | undefined {
    if (isTeamId(id)) return this.teamOverlay.projects.find((project) => project.id === id);
    return this.snapshot?.projects.find((project) => project.id === id);
  }

  // --- AppContext: the team -------------------------------------------------------------------------------------------

  /** The other computers' people for a snapshot, computed once per snapshot and language. */
  private overlayFor(snapshot: OfficeSnapshot | null): TeamOverlay {
    if (snapshot === null || snapshot.team === undefined || this.replay.engaged) return EMPTY_OVERLAY;
    const key = `${locale()}|${snapshot.rev}`;
    if (this.overlayMemo?.key !== key || this.overlayMemo.snapshot !== snapshot)
      this.overlayMemo = {
        key,
        snapshot,
        value: teamOverlay(snapshot.team, firstTeamOrder(snapshot)),
      };
    return this.overlayMemo.value;
  }

  get teamOverlay(): TeamOverlay {
    return this.overlayFor(this.liveSnapshot);
  }

  teamSnapshot(filter: TeamFilter): OfficeSnapshot | null {
    const snapshot = this.snapshot;
    if (snapshot === null) return null;
    const overlay = this.overlayFor(this.liveSnapshot);
    // The hover tip asks on every pointer move: the same inputs give the same object.
    const memo = this.mergedMemo;
    if (memo?.snapshot === snapshot && memo.overlay === overlay && memo.filter === filter) return memo.value;
    const value = withTeam(snapshot, overlay, filter);
    this.mergedMemo = { snapshot, overlay, filter, value };
    return value;
  }

  openTeam(): void {
    if (!this.store.isLocal) {
      this.announce(localOnlyHint());
      this.flash('info', localOnlyHint());
      return;
    }
    this.ui.set({ dialog: 'team', popover: null });
  }

  // --- AppContext: navigation ----------------------------------------------------------------------------------------

  selectAgent(id: string, opts?: { focus?: boolean; tab?: DrawerTab }): void {
    const selection: Selection = { type: 'agent', id };
    this.ui.set({
      selection,
      drawerTab: opts?.tab ?? this.ui.get().drawerTab,
      ...(this.ui.get().narrow ? { sidebarOpen: false } : {}),
    });
    this.world.select(selection, { focus: opts?.focus });
  }

  selectRoom(id: string, opts?: { focus?: boolean }): void {
    const selection: Selection = { type: 'room', id };
    this.ui.set({ selection, ...(this.ui.get().narrow ? { sidebarOpen: false } : {}) });
    this.world.select(selection, { focus: opts?.focus });
  }

  clearSelection(): void {
    this.ui.set({ selection: null, following: false });
    this.world.select(null);
  }

  openTerminalForAgent(agent: Agent): void {
    const project = this.project(agent.projectId);
    const target: TerminalTarget = {
      sessionId: agent.sessionId,
      accountId: agent.accountId,
      agentId: agent.kind === 'sub' ? agent.id : undefined,
      title: agent.name,
      subtitle: [project?.name, agent.kind === 'sub' ? agentRole(agent) : agentTitle(agent)]
        .filter(Boolean)
        .join(' · '),
      officeAgentId: agent.id,
    };
    this.ui.set({ terminal: target });
  }

  openTerminalForSession(session: RecentSession): void {
    const agent = session.agentId ? this.agent(session.agentId) : undefined;
    if (agent) {
      this.selectAgent(agent.id, { focus: true });
      this.openTerminalForAgent(agent);
      return;
    }
    this.ui.set({
      terminal: {
        sessionId: session.sessionId,
        accountId: session.accountId,
        title: session.projectName,
        subtitle: localizedOptional(session.titleMsg, session.title) ?? t('terminal.sessionEnded'),
      },
    });
  }

  closeTerminal(): void {
    this.ui.set({ terminal: null });
  }

  toggleFollow(): void {
    const selection = this.ui.get().selection;
    if (selection?.type !== 'agent') {
      this.announce(t('announce.follow.select'));
      return;
    }
    const following = !this.ui.get().following;
    this.ui.set({ following });
    this.announce(following ? t('announce.follow.on') : t('announce.follow.off'));
  }

  focusComposer(): void {
    const ui = this.ui.get();
    this.ui.set({ composerFocus: ui.composerFocus + 1 });
  }

  togglePopover(id: PopoverId): void {
    const current = this.ui.get().popover;
    this.ui.set({ popover: current === id ? null : id, dialog: null });
  }

  closePopover(): void {
    this.ui.set({ popover: null });
  }

  openDialog(id: DialogId): void {
    this.ui.set({ dialog: this.ui.get().dialog === id ? null : id, popover: null });
  }

  closeDialog(): void {
    this.ui.set({ dialog: null });
  }

  openDay(tab: DayTab): void {
    const ui = this.ui.get();
    if (ui.dialog === 'day' && ui.dayTab === tab) {
      this.ui.set({ dialog: null });
      return;
    }
    this.ui.set({ dialog: 'day', dayTab: tab, popover: null });
  }

  openShare(date: string): void {
    this.ui.set({ dialog: 'share', shareDate: date, popover: null });
  }

  openCustomize(target: CustomizeTarget): void {
    if (!this.isLocal) {
      this.announce(localOnlyHint());
      this.flash('info', localOnlyHint());
      return;
    }
    this.ui.set({ customize: target, dialog: 'customize', popover: null });
  }

  openHire(target: HireTarget = {}): void {
    if (!this.isLocal) {
      this.announce(localOnlyHint());
      this.flash('info', localOnlyHint());
      return;
    }
    this.ui.set({ hire: target, dialog: 'hire', popover: null });
  }

  startReplay(date?: string): void {
    if (!this.store.isLocal) {
      this.announce(localOnlyHint());
      this.flash('info', localOnlyHint());
      return;
    }
    const day = date ?? toDateKey(this.store.now());
    if (!this.replay.engaged) {
      setReplayHint(true);
      this.ui.set({ dialog: null, popover: null, terminal: null, selection: null, following: false });
      this.world.select(null);
    }
    void this.replay.start(day).then(() => {
      if (this.replay.active) {
        this.announce(t('announce.replay.on', { date: formatDateKey(day) }));
        this.noteProgress('timelapse');
      }
    });
    this.refresh();
  }

  stopReplay(): void {
    if (!this.replay.engaged) return;
    this.replay.stop();
    setReplayHint(false);
    this.ui.set({ selection: null, following: false });
    this.world.select(null);
    this.world.setClock(null);
    this.world.resetScene();
    this.pendingSnapshot = this.store.snapshot;
    this.announce(t('announce.replay.off'));
    this.refresh();
  }

  /** The replay's snapshot goes to the world; a jump in the day places everybody at once. */
  private presentReplay(snapshot: OfficeSnapshot, at: number, jump: boolean): void {
    if (jump) this.world.resetScene();
    this.world.setClock(at);
    this.world.setSnapshot(snapshot, at);
  }

  jumpToShell(): void {
    const agents = this.snapshot?.agents ?? [];
    const current = this.ui.get().selection;
    const next = nextAfter(agentsWithShells(agents), current?.type === 'agent' ? current.id : null);
    if (next) this.selectAgent(next.id, { focus: true, tab: 'activity' });
    else this.announce(t('announce.shell.none'));
  }

  // --- AppContext: feedback ------------------------------------------------------------------------------------------

  refresh(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderAll();
    });
  }

  announce(text: string): void {
    // Toggling the content makes screen readers repeat identical messages.
    this.liveRegion.textContent = this.liveRegion.textContent === text ? `${text}${NBSP}` : text;
  }

  /** Toast only (no entry in the notification center): for lightweight confirmations. */
  private flash(level: NoticeLevel, text: string, opts?: { agentId?: string; projectId?: string }): void {
    this.toasts.push({ id: `local-${++this.localId}`, at: this.now(), level, text, ...opts }, this.now());
  }

  notifyLocal(level: NoticeLevel, message: string | Msg, opts?: { agentId?: string; projectId?: string }): void {
    const notice: Notice =
      typeof message === 'string'
        ? { id: `local-${++this.localId}`, at: this.now(), level, text: message, ...opts }
        : {
            id: `local-${++this.localId}`,
            at: this.now(),
            level,
            text: tm(message, message.key),
            msg: message,
            ...opts,
          };
    this.handleNotice(notice);
  }

  copy(text: string, label: string): void {
    const done = (): void => this.flash('success', label);
    const fail = (): void => this.flash('warn', t('toast.copyFailed'));
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fail);
    else fail();
  }

  cue(kind: CueKind): void {
    const prefs = this.prefs.get();
    if (prefs.sounds) this.sound.play(kind, prefs.volume);
  }

  // --- AppContext: actions -------------------------------------------------------------------------------------------

  openRules(tab: RulesTab = 'rules'): void {
    this.rules.start(tab);
    this.ui.set({ dialog: 'rules', popover: null });
  }

  async openRuleEditor(agent: Agent, permission: PermissionRequest): Promise<void> {
    if (!this.isLocal) return;
    // The snapshot leaves the tool input out; the rule suggestion needs it (a command, a file, an address).
    const detailed = await this.store.backend.permission(permission.id).catch(() => permission);
    const draft = suggestRule({
      toolName: detailed.toolName,
      input: detailed.input,
      summary: detailed.summary,
      projectPath: this.project(agent.projectId)?.path ?? agent.projectId,
      accountId: agent.accountId,
    });
    this.rules.start('rules');
    this.rules.startNew(draft, { agentName: agent.name, summary: permissionSummary(permission) });
    this.ui.set({ dialog: 'rules', popover: null });
  }

  async decidePermission(agent: Agent, decision: PermissionDecision): Promise<boolean> {
    const permission = agent.permission;
    if (!permission) return false;
    try {
      const result = await this.store.backend.decidePermission(permission.id, decision);
      if (result === 'already-answered') this.flash('info', t('toast.alreadyAnswered'));
      else
        this.announce(
          decision.behavior === 'allow'
            ? t('announce.permission.allowed')
            : decision.behavior === 'deny'
              ? t('announce.permission.denied')
              : t('announce.permission.terminal'),
        );
      return true;
    } catch (error) {
      this.notifyLocal('warn', describeError(error), { agentId: agent.id });
      return false;
    }
  }

  async sendMessage(agentIds: readonly string[], text: string, teamLabel?: string): Promise<BossMessage[]> {
    if (!this.isLocal) throw new Error(localOnlyHint());
    const sent = await this.store.backend.sendMessage(agentIds, text);
    this.messages.track(sent, teamLabel);
    this.cue('sent');
    this.announce(agentIds.length > 1 ? t('announce.message.team') : t('announce.message.sent'));
    return sent;
  }

  async hireAgent(request: HireRequest): Promise<PendingHire> {
    if (!this.isLocal) throw new Error(localOnlyHint());
    const hire = await this.store.backend.hireAgent(request);
    const project =
      this.project(hire.projectId)?.name ?? hire.projectId.split('/').filter(Boolean).pop() ?? hire.projectId;
    this.cue('sent');
    this.flash('info', t('hire.toast.opened', { project }));
    this.announce(t('announce.hire.opened', { project }));
    return hire;
  }

  noteProgress(event: ProgressEventName): void {
    if (this.store.mode === 'mock' || !this.store.isLocal) return;
    this.store.backend.progressEvent(event).catch(() => undefined);
  }

  async setDemo(on: boolean): Promise<void> {
    await this.store.backend.setDemo(on);
  }

  gitSettings(): Promise<GitSettings> {
    return this.store.backend.gitSettings();
  }

  setGitPullRequests(on: boolean): Promise<GitSettings> {
    return this.store.backend.setGitPullRequests(on);
  }

  codexSettings(): Promise<CodexSettings> {
    return this.store.backend.codexSettings();
  }

  setCodexSessions(on: boolean): Promise<CodexSettings> {
    return this.store.backend.setCodexSessions(on);
  }

  // --- wiring --------------------------------------------------------------------------------------------------------

  private wire(): void {
    this.store.subscribe((event) => {
      if (event.type === 'snapshot') {
        this.onSnapshot(event.snapshot);
        this.inbox.sync(event.snapshot);
      } else if (event.type === 'notice') this.handleNotice(event.notice);
      this.refresh();
    });
    for (const observable of [
      this.ui,
      this.notifications,
      this.toasts,
      this.messages,
      this.inbox,
      this.board,
      this.rules,
      this.team,
      this.progress,
    ])
      observable.subscribe(() => this.refresh());
    this.ui.subscribe((data) => {
      // Opening an agent counts as having seen that its work finished.
      if (data.selection?.type === 'agent' && !this.replay.engaged) this.inbox.markAgentSeen(data.selection.id);
      if (!data.narrow) this.prefs.set({ sidebarOpen: data.sidebarOpen });
      this.prefs.set({ feedOpen: data.feedOpen });
    });

    this.world.onSelect((selection) => {
      this.ui.set({ selection, ...(selection && this.ui.get().narrow ? { sidebarOpen: false } : {}) });
    });
    this.world.onHover((hover) => this.hoverTip.setHover(hover));
    this.world.onBoardClick(() => this.ui.set({ dialog: 'board', popover: null }));
    this.world.onDeskClick((desk) => this.openHire({ projectPath: desk.projectId, deskIndex: desk.deskIndex }));
    this.world.onCameraMode(() => this.refresh());
    onLocaleChange(() => this.onLocaleChanged());

    // Subscribed first, so the panels are rebuilt in the new language and the world options below already carry it.
    bindLanguage(this.prefs);
    this.prefs.subscribe((prefs, changed) => {
      if (changed.includes('dnd')) this.notifications.setDnd(prefs.dnd);
      if (changed.includes('usageLimits') && this.snapshot) this.checkUsageForecast(this.snapshot);
      if (changed.includes('visual')) void this.switchVisual(prefs.visual);
      this.applyWorldOptions();
      this.refresh();
    });
    // The sound of a celebration: only when sounds are on and the person did not ask not to be disturbed.
    onCelebration(({ big }) => {
      if (!this.prefs.get().dnd) this.cue(big ? 'celebrateBig' : 'celebrate');
    });
    this.reducedMotion.addEventListener('change', () => {
      this.applyWorldOptions();
      this.refresh();
    });

    document.addEventListener('keydown', (event) => this.onKeyDown(event));
    document.addEventListener('pointerdown', (event) => this.onPointerDown(event), true);
    bindFeedDismiss({ isOpen: () => this.ui.get().feedOpen, collapse: () => this.ui.set({ feedOpen: false }) });
    window.addEventListener('resize', () => {
      this.ui.set({ narrow: window.innerWidth < NARROW_BREAKPOINT });
      this.refresh();
    });
    window.addEventListener('online', () => this.store.retryNow());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.store.retryNow();
      this.refresh();
    });
    this.scrim.addEventListener('click', () => {
      this.ui.set({ sidebarOpen: false });
      this.clearSelection();
    });
    window.setInterval(() => {
      if (document.hidden) return;
      this.toasts.tick(this.now());
      this.refresh();
    }, CLOCK_MS);
    this.applyWorldOptions();
  }

  private applyWorldOptions(): void {
    const following = this.ui.get().following && this.ui.get().selection?.type === 'agent';
    this.world.setOptions(
      toWorldOptions(this.prefs.get(), {
        followSelected: following,
        reducedMotion: this.reducedMotion.matches,
        hireEnabled: this.isLocal,
      }),
    );
    toggleClass(this.root, 'is-reduced-motion', this.reducedMotion.matches);
  }

  /** Loads the renderer chosen in settings. If it had to fall back, the preference follows what is really shown. */
  async switchVisual(kind: '2d' | '3d'): Promise<void> {
    const notice = await this.world.load(kind);
    if (this.world.kind !== kind) this.prefs.set({ visual: this.world.kind });
    if (notice) this.notifyLocal('warn', notice);
    this.world.setInsets(this.currentInsets());
    this.refresh();
  }

  private onSnapshot(snapshot: OfficeSnapshot): void {
    this.pendingSnapshot = snapshot;
    this.toasts.resolve(snapshot.agents, this.store.now());
    if (!this.replay.engaged) this.dropGoneSelection(snapshot);
    this.checkBuild(snapshot.meta.build);
    this.checkUsageForecast(snapshot);
    this.announceProgress(snapshot.progress);
  }

  /** Clears the selection when its agent or room is not in the snapshot any more. */
  private dropGoneSelection(snapshot: OfficeSnapshot): void {
    const selection = this.ui.get().selection;
    const overlay = this.overlayFor(snapshot);
    if (
      selection?.type === 'agent' &&
      !snapshot.agents.some((agent) => agent.id === selection.id) &&
      !overlay.agents.some((agent) => agent.id === selection.id)
    )
      this.clearSelection();
    if (
      selection?.type === 'room' &&
      !snapshot.projects.some((project) => project.id === selection.id) &&
      !overlay.projects.some((project) => project.id === selection.id)
    )
      this.clearSelection();
  }

  /**
   * A level up or a new achievement gets one toast and a few sparkles, once: what was announced is remembered, and the
   * history counted before the page opened is never announced. With the setting off nothing is shown, but it is
   * remembered all the same, so turning it on does not bring the past back as news.
   */
  private announceProgress(summary: ProgressSummary | undefined): void {
    if (summary === undefined || summary.demo === true || this.replay.engaged) return;
    const result = announcements(this.seen, summary);
    this.seen = result.next;
    if (JSON.stringify(result.next) !== JSON.stringify(loadSeen())) saveSeen(result.next);
    if (!this.prefs.get().evolution || (result.level === undefined && result.count === 0)) return;
    if (result.level !== undefined) {
      const thing = Object.entries(DECOR_LEVELS).find(([, level]) => level === result.level)?.[0];
      const title = t(levelTitleKey(result.level));
      this.notifyLocal(
        'success',
        thing === undefined
          ? t('progress.toast.level', { level: result.level, title })
          : t('progress.toast.levelDecor', {
              level: result.level,
              title,
              thing: t(decorNameKey(thing as Parameters<typeof decorNameKey>[0])),
            }),
      );
    }
    const first = result.unlocked[0];
    if (result.count === 1 && first !== undefined)
      this.notifyLocal('success', t('progress.toast.achievement', { name: t(achievementNameKey(first)) }));
    else if (result.count > 1) this.notifyLocal('success', t('progress.toast.achievements', { n: result.count }));
    if (this.prefs.get().celebrations)
      celebrate(this.root, this.root.querySelector<HTMLElement>('.ao-progress-btn'), this.reducedMotion.matches);
    this.cue('success');
  }

  /** One notification per account and window when the limit is about to be reached (the toast respects "Do not disturb"). */
  private checkUsageForecast(snapshot: OfficeSnapshot): void {
    const limits = this.prefs.get().usageLimits;
    const now = this.store.now();
    const { fresh, seen } = takeFreshAlerts(
      usageAlerts(snapshot.usage, (id) => limits[id], now),
      this.usageAlertsSeen,
    );
    this.usageAlertsSeen = seen;
    for (const alert of fresh) {
      const account = this.account(alert.accountId);
      const time = formatClock(alert.forecast.hitsAt ?? now);
      this.notifyLocal('warn', {
        key: 'usage.alert.hit',
        params: { account: account ? accountLabel(account) : alert.accountId, time },
      });
    }
  }

  private checkBuild(build: string | undefined): void {
    if (this.buildId === undefined) {
      this.buildId = build;
      return;
    }
    if (!buildChanged(this.buildId, build)) return;
    try {
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
      if (Date.now() - last < RELOAD_GUARD_MS) return;
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    } catch {
      // Storage unavailable: reload anyway, once per page load because buildId is updated below.
    }
    this.buildId = build;
    window.location.reload();
  }

  private handleNotice(notice: Notice): void {
    const result = this.notifications.addNotice(notice);
    const interrupt = shouldInterrupt(this.notifications.get(), notice.level);
    if (!interrupt) return;
    if (result.isNew || notice.level === 'alert') this.toasts.push(notice, this.now());
    if (result.isNew) {
      this.cue(CUE_BY_LEVEL[notice.level]);
      if (notice.level === 'alert' && this.prefs.get().browserNotifications && notifyPermission() === 'granted') {
        showBrowserNotification(
          localized(notice.msg, notice.text),
          () => notice.agentId && this.agent(notice.agentId) && this.selectAgent(notice.agentId, { focus: true }),
        );
      }
    }
    if (notice.level === 'alert' || notice.level === 'warn') this.announce(localized(notice.msg, notice.text));
  }

  // --- rendering -----------------------------------------------------------------------------------------------------

  private currentInsets(): ViewInsets {
    const ui = this.ui.get();
    return computeInsets({
      sidebarOpen: ui.sidebarOpen,
      drawerOpen: ui.selection !== null,
      feedOpen: ui.feedOpen,
      narrow: ui.narrow,
      replay: this.replay.engaged,
    });
  }

  private renderAll(): void {
    // While a time-lapse is on, the world shows the replay's snapshots; the live ones wait for the way back.
    if (this.pendingSnapshot && !this.replay.engaged) {
      this.world.setSnapshot(withTeam(this.pendingSnapshot, this.overlayFor(this.pendingSnapshot)), this.store.now());
      this.pendingSnapshot = null;
    }
    if (this.replay.active && this.snapshot) this.dropGoneSelection(this.snapshot);
    const insets = this.currentInsets();
    if (!this.appliedInsets || !sameInsets(this.appliedInsets, insets)) {
      this.appliedInsets = insets;
      this.world.setInsets(insets);
    }
    const ui = this.ui.get();
    const following = ui.following && ui.selection?.type === 'agent';
    if (following !== this.appliedFollow) {
      this.appliedFollow = following;
      this.world.setOptions({ followSelected: following });
    }
    if (this.isLocal !== this.appliedHire) {
      this.appliedHire = this.isLocal;
      this.world.setOptions({ hireEnabled: this.isLocal });
    }
    toggleClass(this.root, 'is-narrow', ui.narrow);
    toggleClass(this.root, 'has-drawer', ui.selection !== null);
    toggleClass(this.root, 'has-sidebar', ui.sidebarOpen);
    toggleClass(this.root, 'has-terminal', ui.terminal !== null);
    toggleClass(this.root, 'feed-open', ui.feedOpen);
    toggleClass(this.root, 'is-replay', this.replay.engaged);
    toggleClass(this.scrim, 'is-open', ui.narrow && (ui.sidebarOpen || ui.selection !== null));

    for (const component of this.components) component.render();
    tickLive(this.root, this.now());
    this.updateTitle();
  }

  private updateTitle(): void {
    const needs = computeCounters(this.liveSnapshot).needsYou;
    const title = needs > 0 ? `(${needs}) AI Office` : 'AI Office';
    if (title !== this.lastTitle) {
      this.lastTitle = title;
      document.title = title;
    }
    if (needs > this.lastNeeds) this.announce(t('announce.needs', { n: needs }));
    this.lastNeeds = needs;
  }

  // --- input ---------------------------------------------------------------------------------------------------------

  private onPointerDown(event: PointerEvent): void {
    this.sound.unlock();
    if (this.ui.get().popover === null) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    // The inbox is a work surface: it stays open while the user looks at agents (Esc or its counter closes it).
    if (this.ui.get().popover === 'inbox' || target.closest('.ao-popover') || target.closest('[data-popover-trigger]'))
      return;
    this.closePopover();
  }

  private onKeyDown(event: KeyboardEvent): void {
    this.sound.unlock();
    if (event.defaultPrevented) return;
    const ui = this.ui.get();
    const replayKeys = this.replay.active && ui.dialog === null && ui.popover === null && ui.terminal === null;
    const action = resolveShortcut(event, isEditable(event.target), ui.terminal !== null, replayKeys);
    if (!action) return;
    if (action !== 'escape') event.preventDefault();
    this.runShortcut(action);
    this.refresh();
  }

  private runShortcut(action: ShortcutAction): void {
    const ui = this.ui.get();
    if (this.replay.engaged && LIVE_ONLY_ACTIONS.has(action)) {
      this.announce(localOnlyHint());
      return;
    }
    switch (action) {
      case 'replay':
        if (this.replay.engaged) this.stopReplay();
        else this.startReplay();
        return;
      case 'replayPlay':
        this.replay.togglePlay();
        return;
      case 'replayBack':
        this.replay.skip(-SKIP_MS);
        return;
      case 'replayForward':
        this.replay.skip(SKIP_MS);
        return;
      case 'replayBackBig':
        this.replay.skip(-BIG_SKIP_MS);
        return;
      case 'replayForwardBig':
        this.replay.skip(BIG_SKIP_MS);
        return;
      case 'search':
        this.ui.set({ sidebarOpen: true });
        this.refresh();
        requestAnimationFrame(() => this.sidebar.focusSearch());
        return;
      case 'follow':
        this.toggleFollow();
        return;
      case 'terminal':
        this.toggleTerminalShortcut();
        return;
      case 'message':
        this.messageShortcut();
        return;
      case 'permission':
        this.jumpToPermission();
        return;
      case 'inbox':
        this.togglePopover('inbox');
        return;
      case 'day':
        this.openDay('time');
        return;
      case 'report':
        this.openDay('report');
        return;
      case 'usage':
        this.openDialog('usage');
        return;
      case 'achievements':
        this.openDialog('achievements');
        return;
      case 'board':
        this.openDialog('board');
        return;
      case 'overview':
        this.world.overview();
        return;
      case 'sidebar':
        this.ui.set({ sidebarOpen: !ui.sidebarOpen });
        return;
      case 'feed':
        this.ui.set({ feedOpen: !ui.feedOpen });
        return;
      case 'help':
        this.openDialog('help');
        return;
      case 'hire':
        if (ui.dialog === 'hire') return;
        this.openHire(ui.selection?.type === 'room' ? { projectPath: ui.selection.id } : {});
        return;
      case 'find':
        this.terminal.openSearch();
        return;
      case 'escape':
        this.escape();
        return;
    }
  }

  private toggleTerminalShortcut(): void {
    const ui = this.ui.get();
    if (ui.terminal) {
      this.closeTerminal();
      return;
    }
    const agent = ui.selection?.type === 'agent' ? this.agent(ui.selection.id) : undefined;
    if (!agent) this.announce(t('announce.terminal.select'));
    else if (!this.isLocal) this.announce(localOnlyHint());
    else this.openTerminalForAgent(agent);
  }

  private messageShortcut(): void {
    const ui = this.ui.get();
    if (!ui.selection) {
      this.announce(t('announce.message.select'));
      return;
    }
    if (!this.isLocal) {
      this.announce(localOnlyHint());
      return;
    }
    this.ui.set({
      drawerTab: ui.selection.type === 'agent' ? 'messages' : ui.drawerTab,
      composerFocus: ui.composerFocus + 1,
    });
  }

  private jumpToPermission(): void {
    const agents = this.snapshot?.agents ?? [];
    const current = this.ui.get().selection;
    const next = nextAfter(agentsWithPermission(agents), current?.type === 'agent' ? current.id : null);
    if (next) this.selectAgent(next.id, { focus: true, tab: 'summary' });
    else this.announce(t('announce.permission.none'));
  }

  /** Esc closes the topmost thing: terminal search, dialog, popover, terminal, the activity feed, then the selection. */
  private escape(): void {
    const ui = this.ui.get();
    if (this.terminal.handleEscape()) return;
    if (ui.dialog) this.closeDialog();
    else if (ui.popover) this.closePopover();
    else if (ui.terminal) this.closeTerminal();
    else if (ui.feedOpen) this.ui.set({ feedOpen: false });
    else if (ui.selection) this.clearSelection();
    else if (this.replay.engaged) this.stopReplay();
    else if (ui.narrow && ui.sidebarOpen) this.ui.set({ sidebarOpen: false });
  }
}
