// The office cat in pixel art: an orange tabby, about a tile wide. Poses: walking (two frames), sitting, grooming and
// sleeping, seen from the side (mirrored for west), the front and the back. Frames are cached canvases.
import type { Dir } from '../../layout/types';
import type { PetMode } from '../../world/pet';
import { type Ctx, context2d, ellipse, hline, makeCanvas, pixel, rect, vline } from '../paint/ctx';

export const CAT_W = 18;
export const CAT_H = 14;
/** Where the feet are in the sprite (px), so it can be placed on a tile position. */
export const CAT_ANCHOR = { x: 9, y: 12 } as const;

const FUR = '#e08a3c';
const STRIPE = '#a85a1a';
const LIGHT = '#f4b36a';
const BELLY = '#f6e3c8';
const EYE = '#1a1410';
const NOSE = '#e87a8a';
const INNER = '#e8a0a0';

const frames = new Map<string, HTMLCanvasElement>();

function sideBody(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  rect(ctx, x, y, w, h, FUR);
  hline(ctx, x, y, w, LIGHT);
  hline(ctx, x + 1, y + h - 1, w - 2, BELLY);
  for (let sx = x + 2; sx < x + w - 1; sx += 3) vline(ctx, sx, y + 1, 2, STRIPE);
}

function sideHead(ctx: Ctx, x: number, y: number, down = false): void {
  rect(ctx, x, y + 1, 5, 4, FUR);
  hline(ctx, x, y + 1, 5, LIGHT);
  pixel(ctx, x, y, FUR);
  pixel(ctx, x + 3, y, FUR);
  pixel(ctx, x + 3, y + 1, INNER);
  pixel(ctx, x + 3, y + 2, down ? FUR : EYE);
  pixel(ctx, x + 5, y + 3, NOSE);
  pixel(ctx, x + 4, y + 4, BELLY);
}

function sideWalk(ctx: Ctx, step: number): void {
  sideBody(ctx, 3, 5, 9, 5);
  sideHead(ctx, 11, 2);
  // tail sways
  const up = step === 0 ? 0 : 1;
  vline(ctx, 2, 3 + up, 4, FUR);
  pixel(ctx, 1, 2 + up, STRIPE);
  pixel(ctx, 2, 2 + up, FUR);
  // legs alternate
  const legs: [number, number][] =
    step === 0
      ? [
          [4, 2],
          [10, 2],
        ]
      : [
          [3, 1],
          [11, 1],
        ];
  const other: [number, number][] =
    step === 0
      ? [
          [3, 1],
          [11, 1],
        ]
      : [
          [4, 2],
          [10, 2],
        ];
  for (const [lx, len] of legs) vline(ctx, lx, 10, len, FUR);
  for (const [lx, len] of other) vline(ctx, lx, 10, len, STRIPE);
}

function sideSit(ctx: Ctx, groom: boolean, t: number): void {
  rect(ctx, 4, 5, 6, 6, FUR);
  hline(ctx, 4, 5, 6, LIGHT);
  for (let y = 6; y < 10; y += 2) hline(ctx, 4, y, 3, STRIPE);
  hline(ctx, 5, 10, 5, BELLY);
  const bob = groom ? Math.floor(t * 3) % 2 : 0;
  sideHead(ctx, groom ? 8 : 9, groom ? 4 + bob : 1, groom);
  // front paws
  rect(ctx, 10, 9, 2, 3, FUR);
  pixel(ctx, 11, 11, BELLY);
  // tail curled around the base
  hline(ctx, 1, 11, 9, STRIPE);
  hline(ctx, 2, 10, 2, FUR);
  pixel(ctx, 1, 10, STRIPE);
}

function sideSleep(ctx: Ctx, t: number): void {
  ellipse(ctx, 8, 9, 7, 3, FUR);
  hline(ctx, 3, 7, 10, LIGHT);
  for (let x = 4; x < 13; x += 3) vline(ctx, x, 8, 2, STRIPE);
  rect(ctx, 11, 8, 4, 3, FUR);
  pixel(ctx, 13, 9, EYE);
  pixel(ctx, 14, 10, NOSE);
  pixel(ctx, 11, 7, FUR);
  hline(ctx, 3, 11, 8, STRIPE);
  const phase = Math.floor(t * 1.2) % 3;
  if (phase > 0) hline(ctx, 15, 6 - phase, 2, '#cfe6ff');
}

function frontView(ctx: Ctx, mode: PetMode, step: number): void {
  ellipse(ctx, 9, 9, 4, 3, FUR);
  hline(ctx, 6, 7, 6, LIGHT);
  rect(ctx, 6, 3, 7, 5, FUR);
  hline(ctx, 6, 3, 7, LIGHT);
  pixel(ctx, 6, 2, FUR);
  pixel(ctx, 12, 2, FUR);
  pixel(ctx, 7, 3, INNER);
  pixel(ctx, 11, 3, INNER);
  pixel(ctx, 7, 5, mode === 'sleep' ? STRIPE : EYE);
  pixel(ctx, 11, 5, mode === 'sleep' ? STRIPE : EYE);
  pixel(ctx, 9, 6, NOSE);
  rect(ctx, 8, 7, 3, 1, BELLY);
  vline(ctx, 9, 3, 1, STRIPE);
  const lift = mode === 'walk' ? step : 0;
  rect(ctx, 7, 10, 2, 2 - lift, FUR);
  rect(ctx, 10, 10, 2, 2 - (mode === 'walk' ? 1 - step : 0), FUR);
  hline(ctx, 7, 11, 5, BELLY);
  pixel(ctx, 14, 9, STRIPE);
  pixel(ctx, 14, 8, FUR);
}

function backView(ctx: Ctx, mode: PetMode, step: number): void {
  ellipse(ctx, 9, 8, 4, 4, FUR);
  hline(ctx, 6, 5, 6, LIGHT);
  rect(ctx, 6, 2, 7, 3, FUR);
  pixel(ctx, 6, 1, FUR);
  pixel(ctx, 12, 1, FUR);
  pixel(ctx, 7, 2, INNER);
  pixel(ctx, 11, 2, INNER);
  for (let y = 5; y < 10; y += 2) hline(ctx, 7, y, 5, STRIPE);
  const sway = mode === 'walk' ? step : 0;
  vline(ctx, 9 + sway, 3, 1, FUR);
  vline(ctx, 13, 3 + sway, 6, FUR);
  pixel(ctx, 13, 2 + sway, STRIPE);
  rect(ctx, 7, 11, 2, 1, FUR);
  rect(ctx, 10, 11, 2, 1, FUR);
}

function paint(ctx: Ctx, mode: PetMode, dir: Dir, step: number, t: number): void {
  if (dir === 's' && mode !== 'sleep') return frontView(ctx, mode, step);
  if (dir === 'n' && mode !== 'sleep') return backView(ctx, mode, step);
  if (mode === 'walk') return sideWalk(ctx, step);
  if (mode === 'sleep') return sideSleep(ctx, t);
  return sideSit(ctx, mode === 'groom', t);
}

/** The frame for a pose. `t` only matters for the little animations of sleeping and grooming (quantised, so frames cache). */
export function catFrame(mode: PetMode, dir: Dir, phase: number, t: number): HTMLCanvasElement {
  const step = phase < 0.5 ? 0 : 1;
  const tick = mode === 'sleep' ? Math.floor(t * 1.2) % 3 : mode === 'groom' ? Math.floor(t * 3) % 2 : 0;
  const mirror = dir === 'w';
  const key = `${mode}|${dir === 'w' ? 'e' : dir}|${mode === 'walk' ? step : 0}|${tick}|${mirror ? 'm' : ''}`;
  let canvas = frames.get(key);
  if (canvas === undefined) {
    canvas = makeCanvas(CAT_W, CAT_H);
    const ctx = context2d(canvas);
    if (mirror) {
      ctx.translate(CAT_W, 0);
      ctx.scale(-1, 1);
    }
    paint(ctx, mode, dir === 'w' ? 'e' : dir, step, mode === 'sleep' ? tick / 1.2 : mode === 'groom' ? tick / 3 : 0);
    frames.set(key, canvas);
  }
  return canvas;
}
