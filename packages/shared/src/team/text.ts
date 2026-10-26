// Cleaning of the texts that cross between machines: no control, format, line-separator, variation-selector or tag
// characters (so no bidirectional overrides, zero-width tricks or hidden text), normalized to NFC, runs of combining marks
// cut short (no "zalgo"), bounded length.
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
// Format characters, variation selectors, and "blank" fillers that draw nothing (Hangul and Braille fillers, the
// combining grapheme joiner, Khmer inherent vowels).
const HIDDEN = /[\p{Cf}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}\u3164\u2800\u115F\u1160\uFFA0]|\u034F|\u17B4|\u17B5/gu;
const MARK_RUN = /(\p{M}{3})\p{M}+/gu;

/** A single-line text without hidden characters, at most `max` characters (code points); undefined when empty. */
export function cleanLine(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .normalize('NFC')
    .replace(BREAKS, ' ')
    .replace(HIDDEN, '')
    .replace(MARK_RUN, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return undefined;
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}

/** Keys and ids that would be dangerous as property names, whatever the characters allow. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
]);

/** An opaque key or id from another machine: plain characters, bounded, and never a special object property. */
export function isSafeKey(value: unknown, min = 1, max = 32): value is string {
  return (
    typeof value === 'string' &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    // Nothing that starts with two underscores (`__proto__`, `__defineGetter__`...) and no inherited method names.
    !value.startsWith('__') &&
    !FORBIDDEN_KEYS.has(value)
  );
}
