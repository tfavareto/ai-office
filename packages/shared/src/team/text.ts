// Cleaning of the texts that cross between machines: no control characters, no bidirectional overrides, bounded length.
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const BIDI = /[‎‏‪-‮⁦-⁩؜]/g;

/** A single-line text without control or bidi characters, at most `max` characters (code points); undefined when empty. */
export function cleanLine(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(CONTROL, ' ').replace(BIDI, '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return undefined;
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}
