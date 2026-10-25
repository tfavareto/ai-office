// What a confetti burst is made of, in units both worlds share: two cannons at the sides of the person shooting inward
// and up, a short fountain straight up, a share of streamers and a few stars. Pure and seeded, so 2D and 3D throw the
// same party and the plan is testable; each world turns the abstract numbers into pixels or metres.
import { Rng } from '../layout/rng';

export type PieceKind = 'piece' | 'ribbon' | 'star';
export type Origin = 'left' | 'right' | 'fountain';

export interface ConfettiSpec {
  origin: Origin;
  /** Launch direction in the vertical plane, radians: 0 = to the right, PI/2 = straight up. */
  angle: number;
  /** Sideways launch (toward or away from the camera) in -1..1, used by 3D. */
  depth: number;
  /** Relative launch speed, about 0.55 to 1.25. */
  speed: number;
  /** Seconds of life, 1.5 to 2.5. */
  life: number;
  kind: PieceKind;
  /** Palette index. */
  color: number;
  /** Relative size 1..3. */
  size: number;
  /** Seconds after the burst before this piece leaves (the fountain keeps going for a moment). */
  delay: number;
}

export const PALETTE_SIZE = 8;
export const MIN_LIFE = 1.5;
export const MAX_LIFE = 2.5;
const CANNON_BASE = 50;
const FOUNTAIN_BASE = 46;
const BIG_BONUS = 1.35;
const FOUNTAIN_SECONDS = 0.5;
const RIBBON_SHARE = 0.14;
const STAR_SHARE = 0.07;

function kindOf(rng: Rng): PieceKind {
  const roll = rng.next();
  if (roll < STAR_SHARE) return 'star';
  return roll < STAR_SHARE + RIBBON_SHARE ? 'ribbon' : 'piece';
}

function make(rng: Rng, origin: Origin, angle: number, speed: number, delay: number): ConfettiSpec {
  const kind = kindOf(rng);
  return {
    origin,
    angle,
    depth: rng.range(-1, 1),
    speed,
    life: rng.range(MIN_LIFE, MAX_LIFE) + (kind === 'ribbon' ? 0.2 : 0),
    kind,
    color: rng.int(PALETTE_SIZE),
    size: kind === 'star' ? 3 : 1 + rng.int(3),
    delay,
  };
}

/** One piece falling in a room-wide shower: same mix of pieces, streamers and stars. */
export function showerPiece(rng: Rng): Pick<ConfettiSpec, 'kind' | 'color' | 'size' | 'life' | 'depth'> {
  const { kind, color, size, life, depth } = make(rng, 'fountain', Math.PI / 2, 1, 0);
  return { kind, color, size, life: life + 0.6, depth };
}

/** The whole burst. `scale` follows the animation level (0.6 / 1 / 1.4); `big` is a milestone. */
export function planBurst(scale: number, big: boolean, seed: number): ConfettiSpec[] {
  const rng = new Rng(seed);
  const bonus = big ? BIG_BONUS : 1;
  const cannon = Math.max(4, Math.round(CANNON_BASE * scale * bonus));
  const fountain = Math.max(4, Math.round(FOUNTAIN_BASE * scale * bonus));
  const specs: ConfettiSpec[] = [];
  for (let k = 0; k < cannon; k++) {
    // the left cannon fires up and to the right (angle < PI/2), the right one up and to the left
    const lean = rng.range(0.35, 1.0);
    specs.push(make(rng, 'left', Math.PI / 2 - lean, rng.range(0.75, 1.25), rng.range(0, 0.08)));
    specs.push(make(rng, 'right', Math.PI / 2 + lean, rng.range(0.75, 1.25), rng.range(0, 0.08)));
  }
  for (let k = 0; k < fountain; k++) {
    specs.push(
      make(rng, 'fountain', Math.PI / 2 + rng.range(-0.28, 0.28), rng.range(0.55, 1.1), rng.range(0, FOUNTAIN_SECONDS)),
    );
  }
  return specs.sort((a, b) => a.delay - b.delay);
}

/** Height of the jump of a celebrating person, in the unit of `height`, `t` seconds into the pose (two jumps per second). */
export function jumpLift(t: number, height: number): number {
  return Math.abs(Math.sin(t * Math.PI * 2.2)) * height;
}
