// Feedback for an empty desk under the pointer: a dashed outline around the workstation and a "+" badge ("hire here").
import { TILE } from '../layout/constants';
import { clamp } from '../layout/rng';
import type { FrameState } from './renderer';

const OUTLINE = 'rgba(160,195,255,0.95)';
const FILL = 'rgba(110,162,255,0.16)';
const BADGE = '#2f6fed';
/** Tiles above the table (monitors) and below it (chair) the outline covers. */
const ABOVE_TILES = 0.75;
const BELOW_TILES = 0.85;
const BADGE_MIN_PX = 9;
const BADGE_MAX_PX = 18;
const BADGE_PER_ZOOM = 9;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the hint in screen space (the overlay pass's coordinates). */
export function drawDeskHint(ctx: CanvasRenderingContext2D, s: FrameState): void {
  const desk = s.hoverDesk;
  if (!desk) return;
  const { cam } = s;
  const from = cam.worldToScreen(desk.rect.x * TILE, (desk.rect.y - ABOVE_TILES) * TILE);
  const to = cam.worldToScreen((desk.rect.x + desk.rect.w) * TILE, (desk.rect.y + desk.rect.h + BELOW_TILES) * TILE);
  const w = to.x - from.x;
  const h = to.y - from.y;
  const pulse = s.options.reducedMotion ? 1 : 0.82 + 0.18 * Math.sin(s.time * 5);
  ctx.save();
  roundedRect(ctx, from.x, from.y, w, h, Math.max(4, cam.zoom * 3));
  ctx.fillStyle = FILL;
  ctx.globalAlpha = pulse;
  ctx.fill();
  ctx.setLineDash([Math.max(4, cam.zoom * 3), Math.max(3, cam.zoom * 2)]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.setLineDash([]);
  const radius = clamp(BADGE_PER_ZOOM * cam.zoom, BADGE_MIN_PX, BADGE_MAX_PX);
  const cx = from.x + w / 2;
  const cy = from.y + h * 0.5;
  ctx.globalAlpha = 1;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = BADGE;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.lineWidth = Math.max(2, radius * 0.18);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.45, cy);
  ctx.lineTo(cx + radius * 0.45, cy);
  ctx.moveTo(cx, cy - radius * 0.45);
  ctx.lineTo(cx, cy + radius * 0.45);
  ctx.stroke();
  ctx.restore();
}
