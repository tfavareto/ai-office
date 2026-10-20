// Keyboard shortcuts: a pure resolver (testable) and the global listener.
export type ShortcutAction =
  | 'search'
  | 'follow'
  | 'terminal'
  | 'message'
  | 'permission'
  | 'inbox'
  | 'day'
  | 'overview'
  | 'sidebar'
  | 'feed'
  | 'help'
  | 'hire'
  | 'escape'
  | 'find';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

const PLAIN_KEYS: Readonly<Record<string, ShortcutAction>> = {
  '/': 'search',
  f: 'follow',
  t: 'terminal',
  n: 'message',
  p: 'permission',
  i: 'inbox',
  m: 'day',
  o: 'overview',
  '[': 'sidebar',
  ']': 'feed',
  '?': 'help',
  h: 'hire',
};

/**
 * Maps a key press to an action. Plain keys are ignored while the user types; Esc always works (inputs stop it
 * themselves when they have something to cancel); Ctrl/Cmd+F is claimed only while the terminal is open.
 */
export function resolveShortcut(event: KeyLike, editing: boolean, terminalOpen: boolean): ShortcutAction | null {
  if (event.key === 'Escape') return 'escape';
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && !event.altKey && event.key.toLowerCase() === 'f') return terminalOpen ? 'find' : null;
  if (modifier || event.altKey || editing) return null;
  return PLAIN_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key] ?? null;
}
