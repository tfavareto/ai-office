import type { Selection } from '../world/api';
import { Observable } from './observable';
export type DrawerTab = 'summary' | 'messages' | 'activity' | 'data';
export type PopoverId = 'notifications' | 'sessions' | 'settings';
export type DialogId = 'day' | 'help';
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
}
export declare const NARROW_BREAKPOINT = 900;
export declare function initialUiData(init: {
    sidebarOpen: boolean;
    feedOpen: boolean;
    narrow: boolean;
}): UiData;
export declare class UiState extends Observable<UiData> {
    set(patch: Partial<UiData>): void;
    toggleRoom(roomId: string): void;
    toggleAccount(accountId: string): void;
}
