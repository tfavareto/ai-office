// Keyboard triage of the inbox: a pure resolver from a key press to an action.
export type InboxKeyAction = 'next' | 'previous' | 'toggle' | 'approve' | 'remember' | 'deny' | 'open' | 'seen';

export interface InboxKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface InboxKeyContext {
  /** Typing in a field: only Esc-like keys are ours, none of these. */
  editing: boolean;
  /** Focus is on a button or link: Space and Enter belong to it. */
  onControl: boolean;
}

const LETTER_ACTIONS: Readonly<Record<string, InboxKeyAction>> = {
  j: 'next',
  k: 'previous',
  a: 'approve',
  d: 'deny',
  e: 'seen',
};

function resolveLetter(letter: string, shift: boolean): InboxKeyAction | null {
  if (shift) return letter === 'a' ? 'remember' : null;
  return LETTER_ACTIONS[letter] ?? null;
}

/** J/K or arrows move · Space selects · A approves · Shift+A approves and remembers · D denies · Enter opens · E marks seen. */
export function resolveInboxKey(event: InboxKeyEvent, context: InboxKeyContext): InboxKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || context.editing) return null;
  switch (event.key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'previous';
    case ' ':
      return context.onControl ? null : 'toggle';
    case 'Enter':
      return context.onControl ? null : 'open';
    default:
      return event.key.length === 1 ? resolveLetter(event.key.toLowerCase(), event.shiftKey) : null;
  }
}
