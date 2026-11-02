// Keyboard shortcuts: a pure resolver (testable) and the global listener.
export type ShortcutAction =
  | 'search'
  | 'follow'
  | 'terminal'
  | 'message'
  | 'permission'
  | 'inbox'
  | 'day'
  | 'report'
  | 'usage'
  | 'achievements'
  | 'board'
  | 'overview'
  | 'sidebar'
  | 'feed'
  | 'help'
  | 'hire'
  | 'replay'
  | 'replayPlay'
  | 'replayBack'
  | 'replayForward'
  | 'replayBackBig'
  | 'replayForwardBig'
  | 'escape'
  | 'find';

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
}

const PLAIN_KEYS: Readonly<Record<string, ShortcutAction>> = {
  '/': 'search',
  f: 'follow',
  t: 'terminal',
  n: 'message',
  p: 'permission',
  i: 'inbox',
  m: 'day',
  r: 'report',
  u: 'usage',
  c: 'achievements',
  k: 'board',
  o: 'overview',
  '[': 'sidebar',
  ']': 'feed',
  '?': 'help',
  h: 'hire',
  l: 'replay',
};

/** Keys that only mean something while a time-lapse is on and nothing else has the keyboard. */
function replayKey(event: KeyLike): ShortcutAction | null {
  const big = event.shiftKey === true;
  switch (event.key) {
    case ' ':
      return 'replayPlay';
    case 'ArrowLeft':
      return big ? 'replayBackBig' : 'replayBack';
    case 'ArrowRight':
      return big ? 'replayForwardBig' : 'replayForward';
    default:
      return null;
  }
}

/**
 * Maps a key press to an action. Plain keys are ignored while the user types; Esc always works (inputs stop it
 * themselves when they have something to cancel); Ctrl/Cmd+F is claimed only while the terminal is open. While a
 * time-lapse is on and no dialog or popover is open (`replay`), Space and the arrows drive it.
 */
export function resolveShortcut(
  event: KeyLike,
  editing: boolean,
  terminalOpen: boolean,
  replay = false,
): ShortcutAction | null {
  if (event.key === 'Escape') return 'escape';
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && !event.altKey && event.key.toLowerCase() === 'f') return terminalOpen ? 'find' : null;
  if (modifier || event.altKey || editing) return null;
  if (replay) {
    const action = replayKey(event);
    if (action !== null) return action;
  }
  return PLAIN_KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key] ?? null;
}
