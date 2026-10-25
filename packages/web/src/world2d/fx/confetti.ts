// Pixel confetti for the 2D world: a fixed pool of particles with a little physics (gravity, drag, flutter), drawn as
// tiny coloured rectangles that tumble between thin and wide. Nothing is allocated while it runs.
import { TILE } from '../../layout/constants';
import { Rng } from '../../layout/rng';
import type { SimEffect, TileRect } from '../../sim/effects';

export const CONFETTI_COLORS = [
  '#ff5d73',
  '#ffd23f',
  '#3ddc97',
  '#4f9dff',
  '#b57bff',
  '#ff9f43',
  '#2ee6d6',
  '#fff6e0',
] as const;

const CAPACITY = 900;
const GRAVITY = 300;
const DRAG = 1.6;
const MIN_LIFE = 1.5;
const MAX_LIFE = 2.5;
const FADE_SECONDS = 0.45;
const BURST_BASE = 104;
const BIG_BONUS = 1.5;
const SHOWER_SECONDS = 2.8;
const SHOWER_PER_SECOND = 150;
/** Height above the feet where a burst starts: the chest of a person. */
const BURST_HEIGHT = 20;
const MAX_EMITTERS = 4;

interface Emitter {
  rect: { x: number; y: number; w: number };
  left: number;
  carry: number;
  scale: number;
  rng: Rng;
}

/** Struct-of-arrays pool: index `i` is one particle while `life[i] > 0`. */
export class ConfettiSystem {
  private readonly x = new Float32Array(CAPACITY);
  private readonly y = new Float32Array(CAPACITY);
  private readonly vx = new Float32Array(CAPACITY);
  private readonly vy = new Float32Array(CAPACITY);
  private readonly spin = new Float32Array(CAPACITY);
  private readonly angle = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly maxLife = new Float32Array(CAPACITY);
  private readonly color = new Uint8Array(CAPACITY);
  private readonly size = new Uint8Array(CAPACITY);
  private readonly phase = new Float32Array(CAPACITY);
  private cursor = 0;
  private alive = 0;
  private emitters: Emitter[] = [];

  get count(): number {
    return this.alive;
  }

  get busy(): boolean {
    return this.alive > 0 || this.emitters.length > 0;
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
    this.emitters = [];
  }

  apply(effect: SimEffect): void {
    if (effect.type === 'burst') this.burst(effect.x * TILE, effect.y * TILE, effect.scale, effect.big, effect.seed);
    else if (effect.type === 'shower') this.shower(effect.rect, effect.scale, effect.seed);
    else if (effect.type === 'spark') this.sparks(effect.x * TILE, effect.y * TILE - BURST_HEIGHT, effect.seed);
  }

  private take(): number {
    for (let n = 0; n < CAPACITY; n++) {
      const i = (this.cursor + n) % CAPACITY;
      if ((this.life[i] as number) <= 0) {
        this.cursor = (i + 1) % CAPACITY;
        this.alive++;
        return i;
      }
    }
    // full: recycle the oldest slot at the cursor
    const i = this.cursor;
    this.cursor = (i + 1) % CAPACITY;
    return i;
  }

  private emit(rng: Rng, px: number, py: number, vx: number, vy: number, life: number): void {
    const i = this.take();
    this.x[i] = px;
    this.y[i] = py;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.spin[i] = rng.range(-9, 9);
    this.angle[i] = rng.range(0, 6.28);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.color[i] = rng.int(CONFETTI_COLORS.length);
    const roll = rng.next();
    this.size[i] = roll < 0.3 ? 1 : roll < 0.75 ? 2 : 3;
    this.phase[i] = rng.range(0, 6.28);
  }

  /** Confetti thrown up and outward from a person standing at (x, y) world px (feet). */
  burst(x: number, y: number, scale: number, big: boolean, seed: number): void {
    const rng = new Rng(seed);
    const n = Math.round(BURST_BASE * scale * (big ? BIG_BONUS : 1));
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + rng.range(-1.15, 1.15);
      const speed = rng.range(70, big ? 190 : 150);
      this.emit(
        rng,
        x + rng.range(-3, 3),
        y - BURST_HEIGHT,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        rng.range(MIN_LIFE, MAX_LIFE),
      );
    }
  }

  /** A small pop of sparkles (a high five). */
  sparks(x: number, y: number, seed: number): void {
    const rng = new Rng(seed);
    for (let k = 0; k < 14; k++) {
      const a = rng.range(0, 6.28);
      const speed = rng.range(25, 70);
      this.emit(rng, x, y, Math.cos(a) * speed, Math.sin(a) * speed - 20, rng.range(0.5, 0.9));
    }
  }

  /** Confetti falling over a whole room for a few seconds. */
  shower(rect: TileRect, scale: number, seed: number): void {
    if (this.emitters.length >= MAX_EMITTERS) this.emitters.shift();
    this.emitters.push({
      rect: { x: rect.x * TILE, y: rect.y * TILE - 6, w: rect.w * TILE },
      left: SHOWER_SECONDS,
      carry: 0,
      scale,
      rng: new Rng(seed),
    });
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.05);
    for (const e of this.emitters) this.run(e, step);
    this.emitters = this.emitters.filter((e) => e.left > 0);
    if (this.alive === 0) return;
    const drag = Math.exp(-DRAG * step);
    for (let i = 0; i < CAPACITY; i++) {
      const life = this.life[i] as number;
      if (life <= 0) continue;
      const left = life - step;
      if (left <= 0) {
        this.life[i] = 0;
        this.alive--;
        continue;
      }
      this.life[i] = left;
      const flutter = Math.sin((this.maxLife[i] as number) * 3 - left * 7 + (this.phase[i] as number)) * 38;
      this.vx[i] = (this.vx[i] as number) * drag + flutter * step;
      this.vy[i] = (this.vy[i] as number) * drag + GRAVITY * step * (1 - drag * 0.35);
      this.x[i] = (this.x[i] as number) + (this.vx[i] as number) * step;
      this.y[i] = (this.y[i] as number) + (this.vy[i] as number) * step;
      this.angle[i] = (this.angle[i] as number) + (this.spin[i] as number) * step;
    }
  }

  private run(e: Emitter, dt: number): void {
    e.left -= dt;
    e.carry += SHOWER_PER_SECOND * e.scale * dt;
    while (e.carry >= 1) {
      e.carry -= 1;
      const px = e.rect.x + e.rng.range(0, e.rect.w);
      this.emit(
        e.rng,
        px,
        e.rect.y,
        e.rng.range(-14, 14),
        e.rng.range(10, 50),
        e.rng.range(MIN_LIFE + 0.4, MAX_LIFE + 0.8),
      );
    }
  }

  /** Draws in world pixels (the context is already in the world transform). Batched by colour. */
  draw(ctx: CanvasRenderingContext2D, vis: { x: number; y: number; w: number; h: number }): void {
    if (this.alive === 0) return;
    const left = vis.x - 8;
    const right = vis.x + vis.w + 8;
    const top = vis.y - 8;
    const bottom = vis.y + vis.h + 8;
    ctx.globalAlpha = 1;
    for (let c = 0; c < CONFETTI_COLORS.length; c++) {
      ctx.fillStyle = CONFETTI_COLORS[c] as string;
      for (let i = 0; i < CAPACITY; i++) {
        const life = this.life[i] as number;
        if (life <= 0 || this.color[i] !== c) continue;
        const px = this.x[i] as number;
        const py = this.y[i] as number;
        if (px < left || px > right || py < top || py > bottom) continue;
        const fade = life < FADE_SECONDS ? life / FADE_SECONDS : 1;
        if (fade < 1) ctx.globalAlpha = fade;
        const s = this.size[i] as number;
        const wide = Math.abs(Math.cos(this.angle[i] as number)) > 0.55;
        ctx.fillRect(Math.round(px), Math.round(py), wide ? s + 2 : s, wide ? s : s + 2);
        if (fade < 1) ctx.globalAlpha = 1;
      }
    }
  }
}
