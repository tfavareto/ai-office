// What components may use from the application (implemented by App). Keeps components decoupled from each other.
import type { Account, Agent, BossMessage, NoticeLevel, OfficeSnapshot, PermissionDecision, Project, RecentSession } from '@ai-office/shared';
import type { Store } from '../net/store';
import type { PrefsStore } from '../prefs/prefs';
import type { MessageCenter } from './message-center';
import type { NotificationsStore, ToastStore } from './notification-stores';
import type { DialogId, DrawerTab, PopoverId, UiState } from './state';
import type { WorldHost } from './world-host';
import type { CueKind } from './sound';

export interface Component {
  readonly el: HTMLElement;
  render(): void;
}

export const LOCAL_ONLY_HINT = 'Disponível apenas quando o AI Office é aberto neste computador (localhost).';

export interface AppContext {
  readonly store: Store;
  readonly ui: UiState;
  readonly prefs: PrefsStore;
  readonly world: WorldHost;
  readonly notifications: NotificationsStore;
  readonly toasts: ToastStore;
  readonly messages: MessageCenter;

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
  jumpToNeedsYou(): void;
  jumpToShell(): void;

  /** Asks for a render pass on the next frame. */
  refresh(): void;
  announce(text: string): void;
  /** Shows a toast and records a notification that originated in the page itself. */
  notifyLocal(level: NoticeLevel, text: string, opts?: { agentId?: string; projectId?: string }): void;
  copy(text: string, label: string): void;
  cue(kind: CueKind): void;

  decidePermission(agent: Agent, decision: PermissionDecision): Promise<boolean>;
  sendMessage(agentIds: readonly string[], text: string, teamLabel?: string): Promise<BossMessage[]>;
  setDemo(on: boolean): Promise<void>;
}
