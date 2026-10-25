// Pixel confetti for the 2D world: a fixed pool of particles with a little physics (gravity, drag, flutter). Each burst
// is two cannons at the person's sides plus a short fountain (`sim/confettiPlan.ts`), made of tumbling pieces, twirling
// streamers and twinkling stars, with a quick flash ring on the floor. Pieces are drawn bigger when zoomed out so they
// read at the overview. Nothing is allocated while it runs, apart from the small plan of a burst.
import { TILE } from '../../layout/constants';
import { Rng } from '../../layout/rng';
import type { SimEffect, TileRect } from '../../sim/effects';
import { type ConfettiSpec, planBurst, showerPiece } from '../../sim/confettiPlan';

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

const CAPACITY = 1400;
const GRAVITY = 300;
const RIBBON_GRAVITY = 0.5;
const DRAG = 1.5;
const FADE_SECONDS = 0.45;
const CANNON_SPEED = 215;
const FOUNTAIN_SPEED = 230;
/** Horizontal distance of the cannons from the person, and the height they fire from. */
const CANNON_OFFSET = 9;
const CANNON_HEIGHT = 17;
const FOUNTAIN_HEIGHT = 22;
const SHOWER_SECONDS = 2.8;
const SHOWER_PER_SECOND = 160;
const MAX_EMITTERS = 4;
const MAX_RINGS = 6;
const RING_SECONDS = 0.5;
const SPARK_COLORS = [1, 7] as const;
/** Pieces get this many times bigger when zoomed out so they read at the overview (never below 1). */
const READ_ZOOM = 1.6;
const MAX_PIECE_SCALE = 2.2;

const KIND_PIECE = 0;
const KIND_RIBBON = 1;
const KIND_STAR = 2;

interface Emitter {
  rect: { x: number; y: number; w: number };
  left: number;
  carry: number;
  scale: number;
  rng: Rng;
}

interface Launch {
  at: number;
  spec: ConfettiSpec;
  x: number;
  y: number;
  rng: Rng;
}

interface Ring {
  x: number;
  y: number;
  age: number;
}

const kindIndex = { piece: KIND_PIECE, ribbon: KIND_RIBBON, star: KIND_STAR } as const;

/** Size factor of the pieces at a camera zoom: bigger when zoomed out. */
export function pieceScale(zoom: number): number {
  return Math.min(MAX_PIECE_SCALE, Math.max(1, READ_ZOOM / Math.max(zoom, 0.1)));
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
  private readonly kind = new Uint8Array(CAPACITY);
  private readonly phase = new Float32Array(CAPACITY);
  private cursor = 0;
  private alive = 0;
  private clock = 0;
  private emitters: Emitter[] = [];
  private launches: Launch[] = [];
  private rings: Ring[] = [];

  get count(): number {
    return this.alive;
  }

  get busy(): boolean {
    return this.alive > 0 || this.emitters.length > 0 || this.launches.length > 0 || this.rings.length > 0;
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
    this.emitters = [];
    this.launches = [];
    this.rings = [];
  }

  apply(effect: SimEffect): void {
    if (effect.type === 'burst') this.burst(effect.x * TILE, effect.y * TILE, effect.scale, effect.big, effect.seed);
    else if (effect.type === 'shower') this.shower(effect.rect, effect.scale, effect.seed);
    else if (effect.type === 'spark') this.sparks(effect.x * TILE, effect.y * TILE - FOUNTAIN_HEIGHT, effect.seed);
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

  private emit(
    rng: Rng,
    px: number,
    py: number,
    vx: number,
    vy: number,
    life: number,
    kind: number,
    color: number,
    size: number,
  ): void {
    const i = this.take();
    this.x[i] = px;
    this.y[i] = py;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.spin[i] = rng.range(-9, 9);
    this.angle[i] = rng.range(0, 6.28);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.color[i] = color;
    this.size[i] = size;
    this.kind[i] = kind;
    this.phase[i] = rng.range(0, 6.28);
  }

  private launch(l: Launch): void {
    const { spec } = l;
    const cannon = spec.origin !== 'fountain';
    const side = spec.origin === 'left' ? -1 : spec.origin === 'right' ? 1 : 0;
    const speed = (cannon ? CANNON_SPEED : FOUNTAIN_SPEED) * spec.speed;
    const px = l.x + side * CANNON_OFFSET + l.rng.range(-1.5, 1.5);
    const py = l.y - (cannon ? CANNON_HEIGHT : FOUNTAIN_HEIGHT);
    this.emit(
      l.rng,
      px,
      py,
      Math.cos(spec.angle) * speed,
      -Math.sin(spec.angle) * speed,
      spec.life,
      kindIndex[spec.kind],
      spec.color,
      spec.size,
    );
  }

  /** Two cannons and a fountain around a person standing at (x, y) world px (feet), with a flash ring on the floor. */
  burst(x: number, y: number, scale: number, big: boolean, seed: number): void {
    const rng = new Rng(seed ^ 0x51ed);
    for (const spec of planBurst(scale, big, seed)) {
      const l: Launch = { at: this.clock + spec.delay, spec, x, y, rng };
      if (spec.delay <= 0.001) this.launch(l);
      else this.launches.push(l);
    }
    this.rings.push({ x, y: y + 2, age: 0 });
    if (this.rings.length > MAX_RINGS) this.rings.shift();
  }

  /** A small pop of sparkles (a high five). */
  sparks(x: number, y: number, seed: number): void {
    const rng = new Rng(seed);
    for (let k = 0; k < 16; k++) {
      const a = rng.range(0, 6.28);
      const speed = rng.range(25, 80);
      this.emit(
        rng,
        x,
        y,
        Math.cos(a) * speed,
        Math.sin(a) * speed - 20,
        rng.range(0.5, 0.9),
        KIND_STAR,
        SPARK_COLORS[k % 2] as number,
        1,
      );
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
    this.clock += step;
    for (const e of this.emitters) this.run(e, step);
    this.emitters = this.emitters.filter((e) => e.left > 0);
    this.runLaunches();
    for (const r of this.rings) r.age += step;
    this.rings = this.rings.filter((r) => r.age < RING_SECONDS);
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
      const ribbon = this.kind[i] === KIND_RIBBON;
      const flutter =
        Math.sin((this.maxLife[i] as number) * 3 - left * 7 + (this.phase[i] as number)) * (ribbon ? 70 : 38);
      this.vx[i] = (this.vx[i] as number) * drag + flutter * step;
      this.vy[i] = (this.vy[i] as number) * drag + GRAVITY * (ribbon ? RIBBON_GRAVITY : 1) * step * (1 - drag * 0.35);
      this.x[i] = (this.x[i] as number) + (this.vx[i] as number) * step;
      this.y[i] = (this.y[i] as number) + (this.vy[i] as number) * step;
      this.angle[i] = (this.angle[i] as number) + (this.spin[i] as number) * step;
    }
  }

  private runLaunches(): void {
    if (this.launches.length === 0) return;
    const waiting: Launch[] = [];
    for (const l of this.launches) {
      if (l.at <= this.clock) this.launch(l);
      else waiting.push(l);
    }
    this.launches = waiting;
  }

  private run(e: Emitter, dt: number): void {
    e.left -= dt;
    e.carry += SHOWER_PER_SECOND * e.scale * dt;
    while (e.carry >= 1) {
      e.carry -= 1;
      const piece = showerPiece(e.rng);
      const px = e.rect.x + e.rng.range(0, e.rect.w);
      this.emit(
        e.rng,
        px,
        e.rect.y,
        e.rng.range(-14, 14),
        e.rng.range(10, 50),
        piece.life,
        kindIndex[piece.kind],
        piece.color,
        piece.size,
      );
    }
  }

  /** Draws in world pixels (the context is already in the world transform). Batched by colour; `zoom` sizes the pieces. */
  draw(ctx: CanvasRenderingContext2D, vis: { x: number; y: number; w: number; h: number }, zoom = 1): void {
    this.drawRings(ctx, vis);
    if (this.alive === 0) return;
    const k = pieceScale(zoom);
    const left = vis.x - 12;
    const right = vis.x + vis.w + 12;
    const top = vis.y - 12;
    const bottom = vis.y + vis.h + 12;
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
        const kind = this.kind[i];
        if (kind === KIND_RIBBON) this.drawRibbon(ctx, i, px, py, k);
        else if (kind === KIND_STAR) this.drawStar(ctx, i, px, py, k, fade);
        else this.drawPiece(ctx, i, px, py, k);
        if (fade < 1) ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawPiece(ctx: CanvasRenderingContext2D, i: number, px: number, py: number, k: number): void {
    const s = (this.size[i] as number) + 1;
    const c = Math.abs(Math.cos(this.angle[i] as number));
    // edge-on it is a sliver, face-on it is a square: the tumble reads even at a few pixels
    const w = c > 0.7 ? s + 2 : c < 0.3 ? Math.max(1, s - 1) : s;
    const h = c > 0.7 ? Math.max(1, s - 1) : c < 0.3 ? s + 2 : s;
    ctx.fillRect(Math.round(px), Math.round(py), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  }

  /** A streamer: a short ribbon of 2 px links that sways as it twirls down. */
  private drawRibbon(ctx: CanvasRenderingContext2D, i: number, px: number, py: number, k: number): void {
    const links = 3 + (this.size[i] as number) * 2;
    const link = Math.max(2, Math.round(2 * k));
    const twirl = this.angle[i] as number;
    for (let n = 0; n < links; n++) {
      const sway = Math.round(Math.sin(twirl + n * 0.6) * 1.8 * k);
      ctx.fillRect(Math.round(px) + sway, Math.round(py) + n * link, link, link);
    }
  }

  /** A four-point star that twinkles. */
  private drawStar(ctx: CanvasRenderingContext2D, i: number, px: number, py: number, k: number, fade: number): void {
    const twinkle = 0.55 + 0.45 * Math.sin((this.angle[i] as number) * 1.7);
    ctx.globalAlpha = Math.min(1, fade * twinkle + 0.15);
    const arm = Math.max(1, Math.round((this.size[i] as number) * k));
    const x = Math.round(px);
    const y = Math.round(py);
    ctx.fillRect(x - arm, y, arm * 2 + 1, 1);
    ctx.fillRect(x, y - arm, 1, arm * 2 + 1);
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }

  /** The flash ring on the floor under the person: a quick expanding ellipse. */
  private drawRings(ctx: CanvasRenderingContext2D, vis: { x: number; y: number; w: number; h: number }): void {
    for (const r of this.rings) {
      if (r.x < vis.x - 40 || r.x > vis.x + vis.w + 40 || r.y < vis.y - 40 || r.y > vis.y + vis.h + 40) continue;
      const t = r.age / RING_SECONDS;
      const radius = 6 + t * 26;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = t < 0.35 ? '#ffffff' : '#ffe27a';
      for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180;
        ctx.fillRect(Math.round(r.x + Math.cos(rad) * radius), Math.round(r.y + Math.sin(rad) * radius * 0.42), 2, 1);
      }
    }
    ctx.globalAlpha = 1;
  }
}
