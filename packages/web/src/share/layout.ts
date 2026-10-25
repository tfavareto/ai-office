// Geometry of the card (pure): where every block goes for each format, how the headline numbers are laid out in a
// grid, and the two text helpers the renderer needs (fit a font size to a width, break a sentence into lines).
import { CARD_SIZES, type CardFormat } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardFonts {
  brand: number;
  date: number;
  title: number;
  statValue: number;
  statLabel: number;
  highlight: number;
  footer: number;
}

export interface CardLayout {
  width: number;
  height: number;
  pad: number;
  header: Rect;
  logo: Rect;
  hero: Rect;
  heroRadius: number;
  statsPanel: Rect;
  tiles: Rect[];
  highlight: Rect;
  /** Most lines the highlight may use. */
  highlightLines: number;
  footer: Rect;
  fonts: CardFonts;
}

/** The picture is captured at this multiple of the size it is drawn at, then scaled down: crisp edges. */
export const HERO_SCALE = 2;
export const MAX_STAT_TILES = 8;

interface Spec {
  pad: number;
  top: number;
  bottom: number;
  header: number;
  logo: number;
  footer: number;
  highlightH: number;
  highlightLines: number;
  tileH: number;
  tileGap: number;
  panelPad: number;
  heroGap: number;
  rowGap: number;
  heroRadius: number;
  maxColumns: (count: number) => number;
  fonts: CardFonts;
}

const SPECS: Readonly<Record<CardFormat, Spec>> = {
  landscape: {
    pad: 40,
    top: 28,
    bottom: 26,
    header: 44,
    logo: 40,
    footer: 22,
    highlightH: 26,
    highlightLines: 1,
    tileH: 64,
    tileGap: 12,
    panelPad: 14,
    heroGap: 14,
    rowGap: 12,
    heroRadius: 18,
    maxColumns: (count) => Math.max(1, count),
    fonts: { brand: 24, date: 16, title: 22, statValue: 34, statLabel: 12, highlight: 18, footer: 15 },
  },
  square: {
    pad: 48,
    top: 44,
    bottom: 44,
    header: 56,
    logo: 52,
    footer: 28,
    highlightH: 76,
    highlightLines: 2,
    tileH: 124,
    tileGap: 14,
    panelPad: 14,
    heroGap: 20,
    rowGap: 18,
    heroRadius: 22,
    maxColumns: (count) => (count <= 3 ? Math.max(1, count) : Math.ceil(count / 2)),
    fonts: { brand: 30, date: 20, title: 28, statValue: 54, statLabel: 16, highlight: 26, footer: 20 },
  },
};

/**
 * Rects of `count` tiles in a grid inside `area`: at most `columns` per row, every row but the last full, and the last
 * one centred. The tiles share the area's width and height equally.
 */
export function tileGrid(area: Rect, count: number, columns: number, gap: number): Rect[] {
  if (count <= 0) return [];
  const cols = Math.max(1, Math.min(columns, count));
  const rows = Math.ceil(count / cols);
  const w = (area.w - gap * (cols - 1)) / cols;
  const h = (area.h - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / cols);
    const inRow = row === rows - 1 ? count - row * cols : cols;
    const rowWidth = inRow * w + (inRow - 1) * gap;
    const x = area.x + (area.w - rowWidth) / 2 + (index - row * cols) * (w + gap);
    return { x, y: area.y + row * (h + gap), w, h };
  });
}

/** Largest font size in [`minPx`, `maxPx`] whose text (`measure(px)` wide) fits `maxWidth`; `minPx` when none does. */
export function fitFont(measure: (px: number) => number, maxWidth: number, maxPx: number, minPx: number): number {
  for (let px = Math.floor(maxPx); px > minPx; px--) if (measure(px) <= maxWidth) return px;
  return minPx;
}

/**
 * Breaks `text` into at most `maxLines` lines no wider than `maxWidth` (`measure` is the width of a string). Breaks
 * between words; the last line ends with an ellipsis when the text does not fit.
 */
export function wrapText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let line = '';
  let index = 0;
  for (; index < words.length; index++) {
    const word = words[index] as string;
    const next = line === '' ? word : `${line} ${word}`;
    if (line === '' || measure(next) <= maxWidth) {
      line = next;
    } else if (lines.length === maxLines - 1) {
      break;
    } else {
      lines.push(line);
      line = word;
    }
  }
  // The last line allowed takes whatever is left; it is cut with an ellipsis when it does not fit.
  const rest = [line, ...words.slice(index)].filter((part) => part !== '').join(' ');
  if (rest !== '') lines.push(rest);
  const last = lines.length - 1;
  if (last >= 0 && measure(lines[last] as string) > maxWidth) {
    let cut = lines[last] as string;
    while (cut.length > 1 && measure(`${cut}…`) > maxWidth) cut = cut.slice(0, -1);
    lines[last] = `${cut.trimEnd()}…`;
  }
  return lines;
}

export function cardLayout(format: CardFormat, statCount: number): CardLayout {
  const spec = SPECS[format];
  const { width, height } = CARD_SIZES[format];
  const count = Math.min(MAX_STAT_TILES, Math.max(0, statCount));
  const columns = spec.maxColumns(count);
  const rows = Math.max(1, Math.ceil(count / Math.max(1, columns)));
  const inner = width - spec.pad * 2;

  const header: Rect = { x: spec.pad, y: spec.top, w: inner, h: spec.header };
  const footer: Rect = { x: spec.pad, y: height - spec.bottom - spec.footer, w: inner, h: spec.footer };
  const highlight: Rect = { x: spec.pad, y: footer.y - spec.rowGap - spec.highlightH, w: inner, h: spec.highlightH };
  const panelH = rows * spec.tileH + (rows - 1) * spec.tileGap + spec.panelPad * 2;
  const statsPanel: Rect = { x: spec.pad, y: highlight.y - spec.rowGap - panelH, w: inner, h: panelH };
  const heroY = header.y + header.h + spec.heroGap;
  const hero: Rect = { x: spec.pad, y: heroY, w: inner, h: statsPanel.y - spec.heroGap - heroY };
  const tilesArea: Rect = {
    x: statsPanel.x + spec.panelPad,
    y: statsPanel.y + spec.panelPad,
    w: statsPanel.w - spec.panelPad * 2,
    h: statsPanel.h - spec.panelPad * 2,
  };
  return {
    width,
    height,
    pad: spec.pad,
    header,
    logo: { x: header.x, y: header.y + (header.h - spec.logo) / 2, w: spec.logo, h: spec.logo },
    hero,
    heroRadius: spec.heroRadius,
    statsPanel,
    tiles: tileGrid(tilesArea, count, columns, spec.tileGap),
    highlight,
    highlightLines: spec.highlightLines,
    footer,
    fonts: spec.fonts,
  };
}

/** Pixel size the office picture is captured at for a layout. */
export function heroPixels(layout: CardLayout): { width: number; height: number } {
  return { width: Math.round(layout.hero.w * HERO_SCALE), height: Math.round(layout.hero.h * HERO_SCALE) };
}
