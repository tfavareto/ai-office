import type { DaylightMode } from '../world/api';
/** Night amount (0 = bright day, 1 = full night) for a local hour in [0, 24). */
export declare function nightFromHour(hour: number): number;
export declare function localHour(date?: Date): number;
/** Smoothly eases the night amount toward the target of the daylight mode. */
export declare class DayNight {
    night: number;
    private mode;
    private initialised;
    setMode(mode: DaylightMode): void;
    target(date?: Date): number;
    update(dt: number, date?: Date): void;
}
export interface NightColors {
    exterior: string;
    /** Multiply colour of a room with nobody in it, and of a lit one. */
    dark: string;
    lit: string;
}
export declare const NIGHT_COLORS: NightColors;
/** Sky gradient stops for the window panes at the given night amount. */
export declare function skyColors(night: number): [string, string];
