import type { ExteriorLayout, Lane } from '../../layout/exterior';
import { TILE } from '../../layout/constants';
import { Rng } from '../../layout/rng';
import { shade } from '../color';
import { type Ctx, context2d, makeCanvas, rect } from '../paint/ctx';

const CAR_COLORS = ['#c0392b', '#2f6fed', '#e8e2d2', '#2d3139', '#e0b43a', '#3b8a52', '#8a8f99', '#6b3fa0'];

interface Car {
  lane: Lane;
  /** Position along the lane in px from the lane start. */
  pos: number;
  speed: number;
  color: string;
  length: number;
}

export interface CarDraw {
  sprite: HTMLCanvasElement;
  x: number;
  y: number;
  /** Headlight position and direction for the night glow. */
  light: { x: number; y: number; dx: number; dy: number };
}

const sprites = new Map<string, HTMLCanvasElement>();

function carSprite(color: string, horizontal: boolean, forward: boolean): HTMLCanvasElement {
  const key = `${color}${horizontal}${forward}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const w = horizontal ? 26 : 12;
  const h = horizontal ? 12 : 26;
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  paintCar(ctx, w, h, color, horizontal, forward);
  sprites.set(key, canvas);
  return canvas;
}

function paintCar(ctx: Ctx, w: number, h: number, color: string, horizontal: boolean, forward: boolean): void {
  rect(ctx, 1, 2, w - 2, h - 2, 'rgba(0,0,0,0.3)');
  rect(ctx, 0, 0, w, h - 1, shade(color, -0.35));
  rect(ctx, 1, 1, w - 2, h - 3, color);
  if (horizontal) {
    const cx = forward ? 7 : 5;
    rect(ctx, cx, 2, 13, h - 5, shade(color, -0.12));
    rect(ctx, cx + 1, 2, 4, h - 5, '#9fc6dc');
    rect(ctx, cx + 8, 2, 4, h - 5, '#8ab4cc');
    rect(ctx, forward ? w - 2 : 0, 2, 2, 2, '#fff2c4');
    rect(ctx, forward ? w - 2 : 0, h - 5, 2, 2, '#fff2c4');
    rect(ctx, forward ? 0 : w - 2, 2, 2, 2, '#c0392b');
    rect(ctx, forward ? 0 : w - 2, h - 5, 2, 2, '#c0392b');
  } else {
    const cy = forward ? 7 : 5;
    rect(ctx, 2, cy, w - 5, 13, shade(color, -0.12));
    rect(ctx, 2, cy + 1, w - 5, 4, '#9fc6dc');
    rect(ctx, 2, cy + 8, w - 5, 4, '#8ab4cc');
    rect(ctx, 2, forward ? h - 3 : 0, 2, 2, '#fff2c4');
    rect(ctx, w - 5, forward ? h - 3 : 0, 2, 2, '#fff2c4');
  }
}

/** Cars looping along the street lanes. Positions are a pure function of time, so they are deterministic. */
export class Traffic {
  private cars: Car[] = [];

  rebuild(layout: ExteriorLayout): void {
    const rng = new Rng(4242);
    this.cars = [];
    for (const lane of layout.lanes) {
      const length = (lane.to - lane.from) * TILE;
      const count = Math.max(1, Math.round(length / 360));
      for (let i = 0; i < count; i++) {
        this.cars.push({
          lane,
          pos: (i / count) * length + rng.range(0, 120),
          speed: rng.range(22, 40),
          color: rng.pick(CAR_COLORS),
          length,
        });
      }
    }
  }

  /** Visible cars at time `t` seconds. */
  draw(t: number, out: CarDraw[]): void {
    out.length = 0;
    for (const car of this.cars) {
      const { lane } = car;
      const travelled = (car.pos + t * car.speed) % car.length;
      const along = lane.dir === 1 ? travelled : car.length - travelled;
      const horizontal = lane.axis === 'h';
      const forward = lane.dir === 1;
      const sprite = carSprite(car.color, horizontal, forward);
      const base = lane.from * TILE + along;
      const x = horizontal ? base - sprite.width / 2 : lane.pos * TILE - sprite.width / 2;
      const y = horizontal ? lane.pos * TILE - sprite.height / 2 : base - sprite.height / 2;
      const front = lane.dir === 1 ? 1 : -1;
      out.push({
        sprite, x, y,
        light: {
          x: horizontal ? x + sprite.width / 2 + front * 13 : x + sprite.width / 2,
          y: horizontal ? y + sprite.height / 2 : y + sprite.height / 2 + front * 13,
          dx: horizontal ? front : 0,
          dy: horizontal ? 0 : front,
        },
      });
    }
  }
}
