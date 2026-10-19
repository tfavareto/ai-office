export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface Pos {
    x: number;
    y: number;
}
export type Measure = (text: string) => number;
/** Longest prefix of `text` (plus an ellipsis) that fits in `maxWidth`; the text itself when it already fits, '' if even one letter does not. */
export declare function ellipsize(text: string, maxWidth: number, measure: Measure): string;
export interface RoomLabelFit {
    /** Name shown (possibly shortened with an ellipsis); '' means the pill is only the colour dot. */
    name: string;
    /** Detail shown after the name ('' when dropped for lack of room). */
    detail: string;
    /** Total pill width in CSS px. */
    width: number;
}
export interface RoomLabelMetrics {
    /** Pill width without any text (dot + paddings). */
    chrome: number;
    /** Gap between the name and the detail. */
    gap: number;
    /** Width of the pill that only holds the dot. */
    dotOnly: number;
}
export declare const ROOM_LABEL_METRICS: RoomLabelMetrics;
/**
 * Fit a room pill into `maxWidth`: full text first, then the name alone, then a shortened name, then just the dot.
 * `measureName` and `measureDetail` use the respective fonts.
 */
export declare function fitRoomLabel(name: string, detail: string, maxWidth: number, measureName: Measure, measureDetail: Measure, m?: RoomLabelMetrics): RoomLabelFit;
export interface LabelItem {
    id: string;
    /** Higher wins a contested spot. */
    priority: number;
    w: number;
    h: number;
    /** Top-left candidates in order of preference; a function gets the placed box of `anchorId` (if any). */
    spots: readonly Pos[] | ((anchor: Box | undefined) => readonly Pos[]);
    /** Item whose placed box the spots depend on (a bubble above its name tag). Must have the higher priority. */
    anchorId?: string;
    /** Never dropped: takes the candidate with the least overlap when none is free. */
    required?: boolean;
    /** Items of the same group are capped by `groupLimit` (bubbles per room). Required items are exempt. */
    group?: string;
}
export interface PlaceOptions {
    /** Fixed boxes that labels must avoid (room pills). */
    obstacles: readonly Box[];
    /** Labels are shifted to stay inside this box (the screen). */
    clip: Box;
    /** Minimum clear distance between two labels. */
    gap: number;
    /** Max non-required items per group. */
    groupLimit: number;
    /** Ids shown last frame: they get `keepBonus` priority so the picture does not flicker. */
    kept?: ReadonlySet<string>;
    keepBonus?: number;
}
export interface Placement {
    x: number;
    y: number;
    /** True when a required item had to overlap something. */
    overlaps: boolean;
}
/**
 * Greedy placement by priority. Each item takes its first candidate that is clear of the obstacles and of the items
 * placed before it; optional items without a free candidate are dropped, required ones overlap as little as possible.
 */
export declare function placeLabels(items: readonly LabelItem[], opts: PlaceOptions): Map<string, Placement>;
/** Bubbles allowed per room at a zoom: one while zoomed out, more as there is space. */
export declare function bubblesPerRoom(zoom: number): number;
/** Name tags need some room to be readable; below this zoom only selected/hovered/waiting people keep one. */
export declare const NAME_MIN_ZOOM = 0.9;
/** Below this zoom only alerts keep a speech bubble. */
export declare const BUBBLE_MIN_ZOOM = 0.7;
/** Room pills are shown up to this zoom (above it the rooms' own wall signs are large enough). */
export declare const ROOM_LABEL_MAX_ZOOM = 2.5;
export interface PillSlot {
    /** Horizontal centre of the pill (centre of the part of the room that is visible). */
    cx: number;
    /** Widest pill that fits inside the visible part of the room. */
    maxWidth: number;
    y: number;
}
/**
 * Where a room's pill goes: centred in the part of the room that is inside the free area, in the room's top band, and
 * never wider than that part. Null when too little of the room is visible to hold a label.
 */
export declare function roomPillSlot(room: Box, free: Box, pillH: number, bandH: number): PillSlot | null;
