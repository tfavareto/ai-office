// Draws the card on a 2D canvas context: background, header, the office picture, the headline numbers, the highlight
// and the footer. System fonts only, so nothing is downloaded and the card looks native on every computer.
import { fitFont, wrapText, type CardLayout, type Rect } from './layout';
import { cardPalette, type CardPalette } from './theme';
import type { CardModel, CardStat, CardTheme } from './types';

const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MIN_VALUE_FONT = 16;
const TILE_PAD_X = 18;
const LOGO_GRID = 32;

type Ctx = CanvasRenderingContext2D;
type Weight = 400 | 500 | 600 | 700 | 800;

function setFont(ctx: Ctx, px: number, weight: Weight): void {
  ctx.font = `${weight} ${px}px ${FONT_FAMILY}`;
}

function widthAt(ctx: Ctx, text: string, px: number, weight: Weight): number {
  setFont(ctx, px, weight);
  return ctx.measureText(text).width;
}

/** Tracking on small capitals (Chromium and Safari); other browsers draw them without it. */
function setTracking(ctx: Ctx, px: number): void {
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

function roundedRect(ctx: Ctx, rect: Rect, radius: number): void {
  const r = Math.min(radius, rect.w / 2, rect.h / 2);
  ctx.beginPath();
  ctx.moveTo(rect.x + r, rect.y);
  ctx.arcTo(rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, r);
  ctx.arcTo(rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h, r);
  ctx.arcTo(rect.x, rect.y + rect.h, rect.x, rect.y, r);
  ctx.arcTo(rect.x, rect.y, rect.x + rect.w, rect.y, r);
  ctx.closePath();
}

function glass(ctx: Ctx, rect: Rect, radius: number, fill: string, border: string): void {
  roundedRect(ctx, rect, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = border;
  ctx.stroke();
}

function drawBackground(ctx: Ctx, layout: CardLayout, palette: CardPalette): void {
  const { width, height } = layout;
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, palette.bgTop);
  base.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  const glow = (x: number, y: number, radius: number, color: string): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  };
  glow(width * 0.88, height * 0.02, Math.max(width, height) * 0.62, palette.glowA);
  glow(width * 0.05, height * 0.98, Math.max(width, height) * 0.5, palette.glowB);
}

/** The AI Office mark: a brand-blue rounded square with the tower glyph (the same drawing as the app's logo). */
function drawLogo(ctx: Ctx, rect: Rect, palette: CardPalette): void {
  const k = rect.w / LOGO_GRID;
  ctx.save();
  ctx.translate(rect.x, rect.y);
  ctx.scale(k, k);
  const fill = ctx.createLinearGradient(0, 0, LOGO_GRID, LOGO_GRID);
  fill.addColorStop(0, palette.brandHigh);
  fill.addColorStop(1, palette.brand);
  roundedRect(ctx, { x: 0, y: 0, w: LOGO_GRID, h: LOGO_GRID }, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.9;
  ctx.beginPath();
  ctx.moveTo(9, 25);
  ctx.lineTo(9, 10.5);
  ctx.quadraticCurveTo(9, 9.5, 10, 9.5);
  ctx.lineTo(16, 9.5);
  ctx.quadraticCurveTo(17, 9.5, 17, 10.5);
  ctx.lineTo(17, 25);
  ctx.stroke();
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.moveTo(17, 14.5);
  ctx.lineTo(21, 14.5);
  ctx.quadraticCurveTo(22, 14.5, 22, 15.5);
  ctx.lineTo(22, 25);
  ctx.moveTo(7, 25);
  ctx.lineTo(25, 25);
  ctx.stroke();
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (const y of [13.5, 17, 20.5]) {
    ctx.moveTo(12, y);
    ctx.lineTo(14, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawHeader(ctx: Ctx, model: CardModel, layout: CardLayout, palette: CardPalette): void {
  const { header, logo, fonts } = layout;
  drawLogo(ctx, logo, palette);
  const midY = header.y + header.h / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  setFont(ctx, fonts.brand, 800);
  ctx.fillStyle = palette.text;
  const brandX = logo.x + logo.w + fonts.brand * 0.55;
  ctx.fillText(model.brand, brandX, midY);
  // "AI Office | My office today": a thin divider, then the title of the card.
  const dividerX = brandX + widthAt(ctx, model.brand, fonts.brand, 800) + fonts.brand * 0.7;
  ctx.fillStyle = palette.panelBorder;
  ctx.fillRect(dividerX, midY - fonts.title * 0.6, 1.5, fonts.title * 1.2);
  ctx.fillStyle = palette.muted;
  setFont(ctx, fonts.title, 600);
  ctx.fillText(model.title, dividerX + fonts.brand * 0.7, midY + 1);

  const padX = fonts.date * 0.95;
  const padY = fonts.date * 0.55;
  const textW = widthAt(ctx, model.date, fonts.date, 600);
  const pill: Rect = {
    x: header.x + header.w - textW - padX * 2,
    y: midY - fonts.date / 2 - padY,
    w: textW + padX * 2,
    h: fonts.date + padY * 2,
  };
  glass(ctx, pill, pill.h / 2, palette.panel, palette.panelBorder);
  ctx.fillStyle = palette.muted;
  setFont(ctx, fonts.date, 600);
  ctx.fillText(model.date, pill.x + padX, midY + 1);
}

function drawHeroPlaceholder(ctx: Ctx, rect: Rect, palette: CardPalette): void {
  const g = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  g.addColorStop(0, palette.tile);
  g.addColorStop(1, palette.panel);
  ctx.fillStyle = g;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

function drawHero(ctx: Ctx, layout: CardLayout, palette: CardPalette, hero: CanvasImageSource | null): void {
  const { hero: rect, heroRadius } = layout;
  ctx.save();
  ctx.shadowColor = palette.heroShadow;
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 14;
  roundedRect(ctx, rect, heroRadius);
  ctx.fillStyle = palette.bgTop;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, rect, heroRadius);
  ctx.clip();
  if (hero === null) drawHeroPlaceholder(ctx, rect, palette);
  else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(hero, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
  roundedRect(ctx, rect, heroRadius);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = palette.heroBorder;
  ctx.stroke();
}

function drawTile(ctx: Ctx, stat: CardStat, tile: Rect, layout: CardLayout, palette: CardPalette): void {
  const { fonts } = layout;
  glass(ctx, tile, 12, palette.tile, palette.panelBorder);
  const tone = palette.tones[stat.tone];
  const x = tile.x + TILE_PAD_X;
  const maxW = tile.w - TILE_PAD_X * 2;
  ctx.fillStyle = tone;
  roundedRect(ctx, { x: tile.x + 8, y: tile.y + tile.h * 0.22, w: 3, h: tile.h * 0.56 }, 1.5);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.save();
  setTracking(ctx, fonts.statLabel * 0.08);
  const label = stat.label.toLocaleUpperCase();
  const labelPx = fitFont((px) => widthAt(ctx, label, px, 700), maxW, fonts.statLabel, fonts.statLabel * 0.7);
  setFont(ctx, labelPx, 700);
  ctx.fillStyle = palette.muted;
  ctx.fillText(label, x, tile.y + tile.h * 0.34);
  ctx.restore();

  const valuePx = fitFont((px) => widthAt(ctx, stat.value, px, 800), maxW, fonts.statValue, MIN_VALUE_FONT);
  setFont(ctx, valuePx, 800);
  ctx.fillStyle = tone;
  ctx.fillText(stat.value, x, tile.y + tile.h * 0.84);
}

function drawStats(ctx: Ctx, model: CardModel, layout: CardLayout, palette: CardPalette): void {
  glass(ctx, layout.statsPanel, 18, palette.panel, palette.panelBorder);
  model.stats.slice(0, layout.tiles.length).forEach((stat, index) => {
    const tile = layout.tiles[index];
    if (tile) drawTile(ctx, stat, tile, layout, palette);
  });
}

function drawHighlight(ctx: Ctx, model: CardModel, layout: CardLayout, palette: CardPalette): void {
  if (model.highlight === null) return;
  const { highlight, fonts } = layout;
  const markerX = highlight.x + fonts.highlight * 0.5;
  const textX = highlight.x + fonts.highlight * 1.5;
  const maxW = highlight.w - (textX - highlight.x);
  const lines = wrapText(
    (text) => widthAt(ctx, text, fonts.highlight, 600),
    model.highlight,
    maxW,
    layout.highlightLines,
  );
  const lineH = fonts.highlight * 1.35;
  const top = highlight.y + (highlight.h - lines.length * lineH) / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  setFont(ctx, fonts.highlight, 600);
  ctx.fillStyle = palette.text;
  lines.forEach((line, index) => ctx.fillText(line, textX, top + lineH * (index + 0.5)));
  const d = fonts.highlight * 0.28;
  const y = top + lineH * 0.5;
  ctx.fillStyle = palette.tones.blue;
  ctx.beginPath();
  ctx.moveTo(markerX, y - d);
  ctx.lineTo(markerX + d, y);
  ctx.lineTo(markerX, y + d);
  ctx.lineTo(markerX - d, y);
  ctx.closePath();
  ctx.fill();
}

function drawFooter(ctx: Ctx, model: CardModel, layout: CardLayout, palette: CardPalette): void {
  const { footer, fonts } = layout;
  const midY = footer.y + footer.h / 2;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  setFont(ctx, fonts.footer, 700);
  ctx.fillStyle = palette.tones.blue;
  ctx.fillText(model.url, footer.x, midY);
  ctx.textAlign = 'right';
  setFont(ctx, fonts.footer, 500);
  ctx.fillStyle = palette.faint;
  ctx.fillText(model.tag, footer.x + footer.w, midY);
}

/**
 * Draws the whole card. `hero` is the picture of the office (or null while it is being made); it is scaled to the
 * hero box, so it should have the same aspect (see `heroPixels`).
 */
export function renderCard(
  ctx: Ctx,
  model: CardModel,
  layout: CardLayout,
  theme: CardTheme,
  hero: CanvasImageSource | null,
): void {
  const palette = cardPalette(theme);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawBackground(ctx, layout, palette);
  drawHeader(ctx, model, layout, palette);
  drawHero(ctx, layout, palette, hero);
  drawStats(ctx, model, layout, palette);
  drawHighlight(ctx, model, layout, palette);
  drawFooter(ctx, model, layout, palette);
  ctx.restore();
}
