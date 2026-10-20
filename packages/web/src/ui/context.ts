// What components may use from the application (implemented by App). Keeps components decoupled from each other.
import type { Account, Agent, BossMessage, HireRequest, Msg, NoticeLevel, OfficeSnapshot, PendingHire, PermissionDecision, Project, RecentSession } from '@ai-office/shared';
import { t } from '../i18n';
import type { Store } from '../net/store';
import type { PrefsStore } from '../prefs/prefs';
import type { InboxController } from './inbox-controller';
import type { MessageCenter } from './message-center';
import type { HireTarget } from './model/hire';
import type { NotificationsStore, ToastStore } from './notification-stores';
import type { DialogId, DrawerTab, PopoverId, UiState } from './state';
import type { WorldHost } from './world-host';
import type { CueKind } from './sound';

export interface Component {
  readonly el: HTMLElement;
  render(): void;
  /** Stops timers and polling; called when the UI shell is rebuilt (language change). */
  dispose?(): void;
}

/** Why a feature is off when the page is not opened on the computer that runs AI Office. */
export function localOnlyHint(): string {
  return t('hint.localOnly');
}

export interface AppContext {
  readonly store: Store;
  readonly ui: UiState;
  readonly prefs: PrefsStore;
  readonly world: WorldHost;
  readonly notifications: NotificationsStore;
  readonly toasts: ToastStore;
  readonly messages: MessageCenter;
  readonly inbox: InboxController;

  readonly snapshot: OfficeSnapshot | null;
  /** Terminal, permissions and messages are available. */
  readonly isLocal: boolean;
  /** Server-aligned current time (epoch ms). */
  now(): number;
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
  setDemo(on: boolean): Promise<void>;
}
