import type { ViewInsets } from '../world/api';
export declare const TOPBAR_HEIGHT = 56;
export declare const SIDEBAR_WIDTH = 320;
export declare const DRAWER_WIDTH = 380;
export declare const PANEL_GAP = 12;
export declare const FEED_COLLAPSED_HEIGHT = 40;
export declare const FEED_EXPANDED_HEIGHT = 200;
export interface LayoutState {
    sidebarOpen: boolean;
    drawerOpen: boolean;
    feedOpen: boolean;
    narrow: boolean;
}
/** The free area of the screen, i.e. what the panels do not cover. On narrow screens panels are overlays. */
export declare function computeInsets(state: LayoutState): ViewInsets;
export declare function sameInsets(a: ViewInsets, b: ViewInsets): boolean;
export declare function layoutVariables(): Record<string, string>;
