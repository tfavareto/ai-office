// Small text checks.
const DELETE = 0x7f;
const FIRST_PRINTABLE = 0x20;

/** True when the text has a control character (NUL, newline, tab, escape, DEL…). */
export function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < FIRST_PRINTABLE || code === DELETE) return true;
  }
  return false;
}
