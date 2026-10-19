// Pure helpers to make translated texts fit the canvases they are painted on (the width of a text depends on the
// language, so fixed font sizes tuned for pt-BR can overflow in en/es).

/**
 * Largest font size, at most `start`, at which a text whose width is `widthAtStart` px at size `start` still fits in
 * `maxPx`; never below `min`. Text width is linear in the font size, so one measurement is enough.
 */
export function fitFontSize(widthAtStart: number, maxPx: number, start: number, min: number): number {
  if (widthAtStart <= maxPx || widthAtStart <= 0) return start;
  return Math.max(min, Math.floor((start * maxPx) / widthAtStart));
}

/** Fits `text` with a CSS font builder: measures once at `start`, then returns the size to paint at. */
export function fitFont(
  ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  text: string,
  font: (size: number) => string,
  maxPx: number,
  start: number,
  min: number,
): number {
  ctx.font = font(start);
  return fitFontSize(ctx.measureText(text).width, maxPx, start, min);
}
