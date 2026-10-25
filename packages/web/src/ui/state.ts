// Transient UI state: what is selected, which panels and overlays are open, filters.
import type { Selection } from '../world/api';
import type { HireTarget } from './model/hire';
import { Observable } from './observable';

export type DrawerTab = 'summary' | 'messages' | 'activity' | 'data';
export type PopoverId = 'notifications' | 'sessions' | 'settings' | 'usage' | 'inbox';
/** The tabs of the "Meu dia" dialog. */
export type DayTab = 'time' | 'report';
export type DialogId = 'day' | 'help' | 'hire' | 'board' | 'rules' | 'usage' | 'share' | 'achievements';

/** What the terminal panel shows: a live agent, or a closed session opened read-only from the history. */
export interface TerminalTarget {
  sessionId: string;
  accountId: string;
  /** Subagent id when the transcript is a subagent's. */
  agentId?: string;
  title: string;
  subtitle?: string;
  /** Office agent id when the session is open in the office. */
  officeAgentId?: string;
}

export interface UiData {
  selection: Selection;
  drawerTab: DrawerTab;
  sidebarOpen: boolean;
  feedOpen: boolean;
  terminal: TerminalTarget | null;
  popover: PopoverId | null;
  dialog: DialogId | null;
  query: string;
  accountFilter: readonly string[];
  collapsedRooms: readonly string[];
  following: boolean;
  /** Viewport narrower than the overlay breakpoint. */
  narrow: boolean;
  /** Bumped to ask the visible composer to take focus. */
  composerFocus: number;
  /** Account the usage dialog should show when it opens (set by the card that was clicked, consumed by the dialog). */
  usageAccount: string | null;
  /** Which tab "Meu dia" shows. */
  dayTab: DayTab;
  /** Where the "hire an agent" dialog starts (the room or desk it was opened from). */
  hire: HireTarget;
  /** The day (YYYY-MM-DD) the share dialog makes a card for. */
  shareDate: string;
}

export const NARROW_BREAKPOINT = 900;

export function initialUiData(init: { sidebarOpen: boolean; feedOpen: boolean; narrow: boolean }): UiData {
  return {
    selection: null,
    drawerTab: 'summary',
    sidebarOpen: init.sidebarOpen && !init.narrow,
    feedOpen: init.feedOpen,
    terminal: null,
    popover: null,
    dialog: null,
    query: '',
    accountFilter: [],
    collapsedRooms: [],
    following: false,
    narrow: init.narrow,
    composerFocus: 0,
    usageAccount: null,
    dayTab: 'time',
    hire: {},
    shareDate: '',
  };
}

export class UiState extends Observable<UiData> {
  set(patch: Partial<UiData>): void {
    const keys = Object.keys(patch) as (keyof UiData)[];
    if (keys.every((key) => Object.is(patch[key], this.value[key]))) return;
    this.replace({ ...this.value, ...patch });
  }

  toggleRoom(roomId: string): void {
    const collapsed = this.value.collapsedRooms;
    this.set({
      collapsedRooms: collapsed.includes(roomId) ? collapsed.filter((id) => id !== roomId) : [...collapsed, roomId],
    });
  }

  toggleAccount(accountId: string): void {
    const selected = this.value.accountFilter;
    this.set({
      accountFilter: selected.includes(accountId)
        ? selected.filter((id) => id !== accountId)
        : [...selected, accountId],
    });
  }
}
