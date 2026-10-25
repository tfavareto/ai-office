// Little effects that tell what a person is doing: code glyphs while typing, a thought bubble, a globe for the web,
// a question mark and a puff when frustrated, an arrow toward the meeting room when delegating, a glow at the
// terminal, an amber pulse when waiting for the user, sparkles while celebrating. Procedural and allocation-free.
import { hash32 } from '../../layout/rng';
import type { Character } from '../../sim/types';
import { CODE_GLYPHS, glyph, thoughtBubble } from './glyphs';

const HEAD_UP = 30;
const GLYPH_CYCLE = 1.1;
const GLYPH_COUNT = 3;
const CODE_COLOR = '#7ee0a0';
const AMBER = '#ffb020';
const SPARKLE_COLORS = ['#fff6e0', '#ffd23f', '#ff9ac2', '#9fe0ff'] as const;

export interface FxContext {
  /** Real seconds (animation clock). */
  time: number;
  reducedMotion: boolean;
  /** World x (px) of the meeting room's middle, to point the delegating arrow at it. */
  meetingX: number | null;
}

const wave = (t: number, hz: number, phase = 0): number => Math.sin((t * hz + phase) * Math.PI * 2);

/** Draws the effects of one person; (fx, fy) is the feet position in world pixels. */
export function drawActivityFx(
  ctx: CanvasRenderingContext2D,
  c: Character,
  fx: number,
  fy: number,
  f: FxContext,
): void {
  const headY = fy - HEAD_UP + (c.seat ? 4 : 0);
  const salt = hash32(c.seed, 17) / 4294967296;
  if (c.mood === 'waiting' || c.alert) pulseRing(ctx, fx, fy, f);
  if (f.reducedMotion) return stillMarks(ctx, c, fx, headY);
  switch (c.mood) {
    case 'typing':
      if (c.pose === 'typeFast') codeGlyphs(ctx, fx, headY, f.time + salt * 3, c.dir);
      break;
    case 'terminal':
      terminalGlow(ctx, c, fx, fy, f.time + salt);
      break;
    case 'web':
      globe(ctx, fx, headY, f.time + salt);
      break;
    case 'thinking':
      thinking(ctx, fx, headY, f.time + salt * 4);
      break;
    case 'frustrated':
      frustrated(ctx, fx, headY, f.time + salt * 2);
      break;
    case 'delegating':
      delegating(ctx, fx, headY, f.time + salt, f.meetingX);
      break;
    default:
      break;
  }
  if (c.celebrating) sparkles(ctx, fx, fy, f.time + salt * 5);
}

/** With reduced motion the marks stay still: no pulsing, no rising glyphs. */
function stillMarks(ctx: CanvasRenderingContext2D, c: Character, fx: number, headY: number): void {
  if (c.mood === 'thinking') ctx.drawImage(thoughtBubble(3), Math.round(fx + 6), Math.round(headY - 14));
  else if (c.mood === 'web') ctx.drawImage(glyph('globe', '#6fb8ff'), Math.round(fx - 3), Math.round(headY - 10));
  else if (c.mood === 'frustrated')
    ctx.drawImage(glyph('question', '#ff8a5c'), Math.round(fx + 6), Math.round(headY - 10));
}

function pulseRing(ctx: CanvasRenderingContext2D, fx: number, fy: number, f: FxContext): void {
  const phase = f.reducedMotion ? 0.35 : (f.time * 0.9) % 1;
  const radius = 8 + phase * 12;
  ctx.globalAlpha = (1 - phase) * 0.8;
  ctx.fillStyle = AMBER;
  for (let a = 0; a < 360; a += 12) {
    const x = Math.round(fx + Math.cos((a * Math.PI) / 180) * radius);
    const y = Math.round(fy - 2 + Math.sin((a * Math.PI) / 180) * radius * 0.42);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;
}

function codeGlyphs(ctx: CanvasRenderingContext2D, fx: number, headY: number, t: number, dir: string): void {
  const side = dir === 'w' ? -1 : 1;
  for (let k = 0; k < GLYPH_COUNT; k++) {
    const age = (t / GLYPH_CYCLE + k / GLYPH_COUNT) % 1;
    const cycle = Math.floor(t / GLYPH_CYCLE + k / GLYPH_COUNT);
    const name = CODE_GLYPHS[hash32(cycle, k + 3) % CODE_GLYPHS.length] as string;
    const x = fx + side * (4 + k * 4) + Math.round(wave(age, 1.3, k) * 2);
    const y = headY - 4 - age * 14;
    ctx.globalAlpha = Math.min(1, (1 - age) * 1.6) * 0.95;
    ctx.drawImage(glyph(name, CODE_COLOR), Math.round(x), Math.round(y));
  }
  ctx.globalAlpha = 1;
}

function terminalGlow(ctx: CanvasRenderingContext2D, c: Character, fx: number, fy: number, t: number): void {
  if (!c.seat) return;
  const flicker = 0.1 + 0.04 * wave(t, 2.3) + 0.02 * wave(t, 5.1);
  ctx.fillStyle = `rgba(110,255,170,${flicker.toFixed(3)})`;
  ctx.fillRect(fx - 6, fy - 24, 12, 7);
  ctx.fillStyle = `rgba(110,255,170,${(flicker * 0.6).toFixed(3)})`;
  ctx.fillRect(fx - 4, fy - 17, 8, 3);
}

function globe(ctx: CanvasRenderingContext2D, fx: number, headY: number, t: number): void {
  const pulse = (t * 0.8) % 1;
  const bob = Math.round(wave(t, 0.6) * 1);
  ctx.globalAlpha = (1 - pulse) * 0.7;
  ctx.fillStyle = '#6fb8ff';
  const r = 4 + Math.round(pulse * 6);
  ctx.fillRect(fx - r, headY - 8 + bob, 1, 1);
  ctx.fillRect(fx + r, headY - 8 + bob, 1, 1);
  ctx.fillRect(fx, headY - 8 - r + bob, 1, 1);
  ctx.globalAlpha = 1;
  ctx.drawImage(glyph('globe', '#6fb8ff'), Math.round(fx - 3), Math.round(headY - 12 + bob));
}

function thinking(ctx: CanvasRenderingContext2D, fx: number, headY: number, t: number): void {
  const dots = 1 + (Math.floor(t * 1.8) % 3);
  const bob = Math.round(wave(t, 0.5) * 1);
  ctx.drawImage(thoughtBubble(dots), Math.round(fx + 5), Math.round(headY - 17 + bob));
}

function frustrated(ctx: CanvasRenderingContext2D, fx: number, headY: number, t: number): void {
  const shake = Math.round(wave(t, 4) * 1);
  ctx.drawImage(glyph('question', '#ff8a5c'), Math.round(fx + 6 + shake), Math.round(headY - 11));
  const puff = (t * 1.1) % 1;
  ctx.globalAlpha = (1 - puff) * 0.85;
  ctx.fillStyle = '#e9edf5';
  const size = 1 + Math.floor(puff * 3);
  ctx.fillRect(Math.round(fx - 9 - puff * 4), Math.round(headY - 2 - puff * 6), size, size);
  ctx.fillRect(Math.round(fx - 6 - puff * 5), Math.round(headY - 5 - puff * 7), size, size);
  ctx.globalAlpha = 1;
}

function delegating(
  ctx: CanvasRenderingContext2D,
  fx: number,
  headY: number,
  t: number,
  meetingX: number | null,
): void {
  const toRight = meetingX === null || meetingX >= fx;
  const push = Math.round((wave(t, 1.2) + 1) * 1.5);
  const sprite = glyph('arrow', '#ffd23f');
  ctx.save();
  if (!toRight) {
    ctx.translate(Math.round(fx), 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite, 8 + push, Math.round(headY - 6));
  } else ctx.drawImage(sprite, Math.round(fx + 8 + push), Math.round(headY - 6));
  ctx.restore();
}

function sparkles(ctx: CanvasRenderingContext2D, fx: number, fy: number, t: number): void {
  for (let k = 0; k < 5; k++) {
    const twinkle = (t * 2.2 + k * 0.37) % 1;
    if (twinkle > 0.6) continue;
    const angle = k * 1.26 + t * 1.3;
    const x = fx + Math.cos(angle) * (10 + (k % 2) * 4);
    const y = fy - 18 + Math.sin(angle) * 9 - twinkle * 6;
    ctx.globalAlpha = 1 - twinkle / 0.6;
    ctx.drawImage(glyph('spark', SPARKLE_COLORS[k % SPARKLE_COLORS.length] as string), Math.round(x), Math.round(y));
  }
  ctx.globalAlpha = 1;
}
