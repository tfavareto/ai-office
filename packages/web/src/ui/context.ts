// What components may use from the application (implemented by App). Keeps components decoupled from each other.
import type {
  Account,
  Agent,
  BossMessage,
  FeedItem,
  GitSettings,
  HireRequest,
  Msg,
  NoticeLevel,
  OfficeSnapshot,
  PendingHire,
  PermissionDecision,
  PermissionRequest,
  Project,
  ProgressEventName,
  RecentSession,
} from '@ai-office/shared';
import { t } from '../i18n';
import type { Store } from '../net/store';
import type { PrefsStore } from '../prefs/prefs';
import type { BoardStore } from './board-store';
import type { InboxController } from './inbox-controller';
import type { ProgressController } from './progress-controller';
import type { MessageCenter } from './message-center';
import type { HireTarget } from './model/hire';
import type { NotificationsStore, ToastStore } from './notification-stores';
import type { ReplayController } from './replay-controller';
import type { RulesController, RulesTab } from './rules-controller';
import type { DayTab, DialogId, DrawerTab, PopoverId, UiState } from './state';
import type { WorldHost } from './world-host';
import type { CueKind } from './sound';

export interface Component {
  readonly el: HTMLElement;
  render(): void;
  /** Stops timers and polling; called when the UI shell is rebuilt (language change). */
  dispose?(): void;
}

let replayHint = false;

/** While a time-lapse is on, the features that act on live sessions explain that with `hint.replay` instead. */
export function setReplayHint(on: boolean): void {
  replayHint = on;
}

/** Why a feature is off: the page is not opened on the computer that runs AI Office, or a time-lapse is playing. */
export function localOnlyHint(): string {
  return t(replayHint ? 'hint.replay' : 'hint.localOnly');
}

export interface AppContext {
  readonly store: Store;
  readonly ui: UiState;
  readonly prefs: PrefsStore;
  readonly world: WorldHost;
  readonly notifications: NotificationsStore;
  readonly toasts: ToastStore;
  readonly messages: MessageCenter;
  readonly board: BoardStore;
  readonly inbox: InboxController;
  readonly rules: RulesController;
  readonly replay: ReplayController;
  readonly progress: ProgressController;

  /** What the panels show: the office now, or the office at the replay's time while a time-lapse is on. */
  readonly snapshot: OfficeSnapshot | null;
  /** The office now, whatever the panels show. */
  readonly liveSnapshot: OfficeSnapshot | null;
  /** Terminal, permissions and messages are available (never while a time-lapse is on). */
  readonly isLocal: boolean;
  /** Server-aligned current time (epoch ms). */
  now(): number;
  /** The activity feed: the latest items of the office now, or up to the replay's time. */
  feed(): readonly FeedItem[];
  agent(id: string): Agent | undefined;
  account(id: string): Account | undefined;
  project(id: string): Project | undefined;

  selectAgent(id: string, opts?: { focus?: boolean; tab?: DrawerTab }): void;
  selectRoom(id: string, opts?: { focus?: boolean }): void;
  clearSelection(): void;
  openTerminalForAgent(agent: Agent): void;
  openTerminalForSession(session: RecentSession): void;
  closeTerminal(): void;
  toggleFollow(): void;
  focusComposer(): void;
  togglePopover(id: PopoverId): void;
  closePopover(): void;
  openDialog(id: DialogId): void;
  closeDialog(): void;
  /** Opens "Meu dia" on a tab (closes it when it is already open there). */
  openDay(tab: DayTab): void;
  /** Opens the share dialog: a picture of the office and the numbers of a day (YYYY-MM-DD), ready to post. */
  openShare(date: string): void;
  /** Plays a day (default: today) as a time-lapse; the page is read-only until `stopReplay`. */
  startReplay(date?: string): void;
  /** Leaves the time-lapse and shows the live office again. */
  stopReplay(): void;
  /** Opens the "hire an agent" dialog (no-op with a hint when the page is not local). */
  openHire(target?: HireTarget): void;
  jumpToShell(): void;

  /** Asks for a render pass on the next frame. */
  refresh(): void;
  announce(text: string): void;
  /**
   * Shows a toast and records a notification that originated in the page itself. A `Msg` (keys of the app catalog)
   * is re-rendered when the language changes; a plain string is kept as it is.
   */
  notifyLocal(level: NoticeLevel, message: string | Msg, opts?: { agentId?: string; projectId?: string }): void;
  /** Copies `text` to the clipboard and confirms with a toast saying `label`. */
  copy(text: string, label: string): void;
  cue(kind: CueKind): void;

  decidePermission(agent: Agent, decision: PermissionDecision): Promise<boolean>;
  sendMessage(agentIds: readonly string[], text: string, teamLabel?: string): Promise<BossMessage[]>;
  /** Opens a terminal with Claude Code for a new agent; rejects with the server's error. */
  hireAgent(request: HireRequest): Promise<PendingHire>;
  /** Opens the approval rules dialog on a tab. */
  openRules(tab?: RulesTab): void;
  /** "Create rule…": opens the rule editor pre-filled from a permission request of an agent. */
  openRuleEditor(agent: Agent, permission: PermissionRequest): Promise<void>;
  /** Tells the server the person did something only the page can see (the first time counts). Never fails visibly. */
  noteProgress(event: ProgressEventName): void;
  setDemo(on: boolean): Promise<void>;
  /** Server settings of the git integration (local access only). */
  gitSettings(): Promise<GitSettings>;
  /** Turns the pull request lookup (the `gh` CLI, which uses the internet) on or off. */
  setGitPullRequests(on: boolean): Promise<GitSettings>;
}
