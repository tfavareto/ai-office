export type ShortcutAction = 'search' | 'follow' | 'terminal' | 'message' | 'permission' | 'day' | 'overview' | 'sidebar' | 'feed' | 'help' | 'escape' | 'find';
export interface KeyLike {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
}
/**
 * Maps a key press to an action. Plain keys are ignored while the user types; Esc always works (inputs stop it
 * themselves when they have something to cancel); Ctrl/Cmd+F is claimed only while the terminal is open.
 */
export declare function resolveShortcut(event: KeyLike, editing: boolean, terminalOpen: boolean): ShortcutAction | null;
