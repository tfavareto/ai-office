import { type DaylightMode, type WorldOptions } from '../world/api';
export declare const PREFS_KEY = "ai-office:prefs";
export type VisualKind = '2d' | '3d';
export type BubbleMode = WorldOptions['bubbles'];
export type Liveliness = WorldOptions['liveliness'];
export interface Prefs {
    visual: VisualKind;
    daylight: DaylightMode;
    showNames: boolean;
    bubbles: BubbleMode;
    animation: Liveliness;
    sounds: boolean;
    /** 0..1 */
    volume: number;
    browserNotifications: boolean;
    /** "Não perturbe": only alerts interrupt. */
    dnd: boolean;
    sidebarOpen: boolean;
    feedOpen: boolean;
}
export declare const DEFAULT_PREFS: Prefs;
/** Validates unknown data (parsed JSON) into complete preferences; invalid fields fall back to defaults. */
export declare function parsePrefs(raw: unknown): Prefs;
export declare function parsePrefsJson(text: string | null): Prefs;
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export declare function loadPrefs(storage?: StorageLike | null): Prefs;
export declare function savePrefs(prefs: Prefs, storage?: StorageLike | null): boolean;
export declare function toWorldOptions(prefs: Prefs, extra: {
    followSelected: boolean;
    reducedMotion: boolean;
}): WorldOptions;
type Listener = (prefs: Prefs, changed: readonly (keyof Prefs)[]) => void;
/** Holds the current preferences, persists changes and tells listeners which keys changed. */
export declare class PrefsStore {
    private readonly storage;
    private current;
    private readonly listeners;
    constructor(initial?: Prefs, storage?: StorageLike | null);
    get(): Prefs;
    set(patch: Partial<Prefs>): void;
    subscribe(listener: Listener): () => void;
}
export {};
