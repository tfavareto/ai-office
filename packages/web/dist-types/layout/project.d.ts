import type { AreaLayout, AreaTheme, RoomSpec } from './types';
/** Floor column of the aisle that connects the door with every workstation. */
export declare const AISLE_FX = 4;
export declare function projectTheme(seed: number): AreaTheme;
/** A project room: 6 workstations around a central aisle, deterministic variations from the project seed. */
export declare function layoutProjectRoom(spec: RoomSpec): AreaLayout;
