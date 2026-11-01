// Messages between connected terminals. A message arrives as if pasted, so it must never carry anything the terminal or
// the program would obey: Esc, Ctrl+C, or the end of the paste, after which the rest would count as typed keys.

/** Everything below space except tab and line feed, plus DEL and the C1 controls. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
/** A carriage return would press Enter. */
const CARRIAGE_RETURN = /\r\n?/g;

export function cleanMessage(text: string): string {
  return text.replace(CARRIAGE_RETURN, ' ').replace(CONTROL_CHARS, '');
}

/** What the receiving agent reads: who sent it, in English like the instructions it got when it started. */
export function formatDelivery(fromName: string, text: string): string {
  return `[Message from ${fromName}, sent through AI Office] ${text}`;
}

export const PASTE_START = '\x1b[200~';
export const PASTE_END = '\x1b[201~';
