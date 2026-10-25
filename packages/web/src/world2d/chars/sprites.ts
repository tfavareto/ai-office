import type { Dir } from '../../layout/types';
import type { Pose } from '../../sim/types';
import { mix, shade } from '../color';
import { type Ctx, context2d, makeCanvas } from '../paint/ctx';
import type { Look } from './looks';

export const SPRITE_W = 24;
export const SPRITE_H = 34;
/** Feet anchor inside the cell. */
export const ANCHOR_X = 12;
export const ANCHOR_Y = 32;

type ArmPose =
  | 'down'
  | 'swingF'
  | 'swingB'
  | 'up'
  | 'forward'
  | 'cup'
  | 'typeA'
  | 'typeB'
  | 'head'
  | 'lap'
  | 'out'
  | 'mouth'
  | 'gesture'
  | 'raised'
  | 'chin'
  | 'scratch'
  | 'point'
  | 'waveA'
  | 'waveB'
  | 'clapA'
  | 'clapB'
  | 'shakeA'
  | 'shakeB'
  | 'doc'
  | 'tap';
type LegPose = 'stand' | 'stepL' | 'stepR' | 'sit' | 'hidden';
type Prop = 'cup' | 'popcorn' | 'book' | 'paddle' | 'stick' | 'doc' | 'docFlip' | null;

interface Rig {
  bob: number;
  sit: number;
  legs: LegPose;
  armL: ArmPose;
  armR: ArmPose;
  headDx: number;
  headDy: number;
  eyesClosed: boolean;
  /** Mouth wide open (a yawn). */
  yawn: boolean;
  prop: Prop;
}

const FRAMES: Record<Pose, number> = {
  stand: 1,
  walk: 4,
  sit: 1,
  type: 2,
  hand: 2,
  coffee: 3,
  celebrate: 4,
  sleep: 2,
  lean: 2,
  stretch: 3,
  popcorn: 2,
  talk: 3,
  listen: 2,
  play: 4,
  arcade: 2,
  read: 1,
  wash: 2,
  readDoc: 4,
  typeFast: 2,
  think: 2,
  point: 2,
  scratch: 2,
  wave: 2,
  clap: 2,
  highfive: 2,
  shake: 2,
};
const FRAME_SECONDS: Partial<Record<Pose, number>> = {
  type: 0.16,
  talk: 0.28,
  coffee: 1.1,
  play: 0.14,
  sleep: 1.4,
  popcorn: 0.6,
  stretch: 0.9,
  listen: 0.9,
  hand: 0.35,
  celebrate: 0.17,
  lean: 0.3,
  readDoc: 0.55,
  typeFast: 0.07,
  think: 0.9,
  point: 0.5,
  scratch: 0.16,
  wave: 0.2,
  clap: 0.12,
  highfive: 0.3,
  shake: 0.22,
};

export function poseFrames(pose: Pose): number {
  return FRAMES[pose];
}

export function frameFor(pose: Pose, poseT: number, walkPhase: number): number {
  if (pose === 'walk') return Math.floor(walkPhase * 4) & 3;
  const n = FRAMES[pose];
  if (n === 1) return 0;
  return Math.floor(poseT / (FRAME_SECONDS[pose] ?? 0.4)) % n;
}

function rigFor(pose: Pose, frame: number, dir: Dir): Rig {
  const base: Rig = {
    bob: 0,
    sit: 0,
    legs: 'stand',
    armL: 'down',
    armR: 'down',
    headDx: 0,
    headDy: 0,
    eyesClosed: false,
    yawn: false,
    prop: null,
  };
  const back = dir === 'n';
  switch (pose) {
    case 'stand':
    case 'listen':
      return { ...base, headDy: pose === 'listen' && frame === 1 ? 1 : 0 };
    case 'walk': {
      const swing = [0, 1, 0, -1][frame];
      return {
        ...base,
        bob: frame % 2 === 1 ? -1 : 0,
        legs: frame === 1 ? 'stepL' : frame === 3 ? 'stepR' : 'stand',
        armL: swing > 0 ? 'swingB' : swing < 0 ? 'swingF' : 'down',
        armR: swing > 0 ? 'swingF' : swing < 0 ? 'swingB' : 'down',
      };
    }
    case 'sit':
      return {
        ...base,
        sit: 3,
        legs: back ? 'hidden' : 'sit',
        armL: back ? 'forward' : 'lap',
        armR: back ? 'forward' : 'lap',
      };
    case 'type':
      return {
        ...base,
        sit: 3,
        legs: 'hidden',
        armL: frame === 0 ? 'typeA' : 'typeB',
        armR: frame === 0 ? 'typeB' : 'typeA',
      };
    case 'hand':
      return { ...base, armR: 'raised', armL: 'down', bob: frame === 1 ? -1 : 0 };
    case 'coffee':
      return { ...base, armR: 'cup', armL: 'down', prop: 'cup', headDy: frame === 1 ? 1 : 0, bob: 0 };
    case 'celebrate':
      return {
        ...base,
        armL: frame === 2 ? 'raised' : 'up',
        armR: frame === 0 ? 'raised' : 'up',
        legs: frame % 2 === 1 ? 'stepL' : frame === 2 ? 'stepR' : 'stand',
        bob: frame % 2 === 1 ? -3 : 0,
        headDx: frame === 0 ? -1 : frame === 2 ? 1 : 0,
      };
    case 'sleep':
      return {
        ...base,
        sit: 4,
        legs: 'hidden',
        armL: 'forward',
        armR: 'forward',
        headDy: 3 + frame,
        headDx: 0,
        eyesClosed: true,
      };
    case 'lean':
      return { ...base, sit: 5, legs: 'hidden', armL: 'head', armR: frame === 0 ? 'lap' : 'tap', headDy: -1 };
    case 'stretch':
      return {
        ...base,
        sit: 3,
        legs: 'hidden',
        armL: 'up',
        armR: 'up',
        headDy: frame === 1 ? -1 : 0,
        yawn: frame >= 1,
        eyesClosed: frame === 1,
      };
    case 'readDoc':
      return {
        ...base,
        sit: 3,
        legs: 'hidden',
        armL: 'doc',
        armR: 'doc',
        headDx: [0, 1, 0, -1][frame] ?? 0,
        headDy: 1,
        prop: frame === 3 ? 'docFlip' : 'doc',
      };
    case 'typeFast':
      return {
        ...base,
        sit: 3,
        legs: 'hidden',
        armL: frame === 0 ? 'typeA' : 'typeB',
        armR: frame === 0 ? 'typeB' : 'typeA',
        headDy: 1,
      };
    case 'think':
      return {
        ...base,
        sit: 3,
        legs: 'hidden',
        armL: 'forward',
        armR: 'chin',
        headDy: frame === 1 ? 1 : 0,
        headDx: frame,
      };
    case 'point':
      return { ...base, sit: 3, legs: 'hidden', armL: 'forward', armR: 'point', headDy: frame === 1 ? -1 : 0 };
    case 'scratch':
      return { ...base, sit: 3, legs: 'hidden', armL: 'forward', armR: 'scratch', headDy: 1, headDx: frame };
    case 'wave':
      return { ...base, armR: frame === 0 ? 'waveA' : 'waveB', bob: 0 };
    case 'clap':
      return {
        ...base,
        armL: frame === 0 ? 'clapA' : 'clapB',
        armR: frame === 0 ? 'clapA' : 'clapB',
        bob: frame === 1 ? -1 : 0,
      };
    case 'highfive':
      return { ...base, armR: 'raised', armL: 'down', bob: frame === 1 ? -1 : 0 };
    case 'shake':
      return { ...base, armR: frame === 0 ? 'shakeA' : 'shakeB', armL: 'down' };
    case 'popcorn':
      return {
        ...base,
        sit: 4,
        legs: back ? 'hidden' : 'sit',
        armL: 'lap',
        armR: frame === 0 ? 'mouth' : 'lap',
        prop: 'popcorn',
      };
    case 'talk':
      return {
        ...base,
        armL: frame === 1 ? 'gesture' : 'down',
        armR: frame === 2 ? 'gesture' : frame === 1 ? 'out' : 'down',
        headDy: frame === 1 ? 1 : 0,
      };
    case 'play':
      return {
        ...base,
        legs: frame % 2 === 0 ? 'stepL' : 'stand',
        armR: 'forward',
        armL: 'down',
        prop: 'paddle',
        bob: frame === 2 ? -1 : 0,
      };
    case 'arcade':
      return { ...base, armL: 'forward', armR: 'forward', prop: 'stick', bob: frame === 1 ? -1 : 0 };
    case 'read':
      return { ...base, armL: 'forward', armR: 'forward', prop: 'book' };
    case 'wash':
      return { ...base, armL: 'forward', armR: 'forward', bob: 0, headDy: frame };
  }
}

/** Mirrors drawing horizontally around the centre column when drawing a west-facing character. */
class Pen {
  constructor(
    private ctx: Ctx,
    private flip: boolean,
  ) {}
  r(x: number, y: number, w: number, h: number, c: string): void {
    this.ctx.fillStyle = c;
    const px = this.flip ? SPRITE_W - x - w : x;
    this.ctx.fillRect(px, y + 2, w, h);
  }
}

function hairFront(p: Pen, look: Look, hx: number, hy: number, w: number): void {
  const { hair, hairShade, hairLight, hairStyle: s } = look;
  const f = look.gender === 'f';
  p.r(hx, hy - 1, w, 3, hair);
  p.r(hx + 1, hy - 2, w - 2, 1, hair);
  p.r(hx + 1, hy - 1, 2, 1, hairLight);
  if (f) {
    if (s === 0 || s === 4) {
      p.r(hx - 1, hy, 2, 12, hair);
      p.r(hx + w - 1, hy, 2, 12, hair);
      p.r(hx - 1, hy + 4, 1, 8, hairShade);
    } else if (s === 1) {
      p.r(hx - 1, hy, 2, 7, hair);
      p.r(hx + w - 1, hy, 2, 7, hair);
    } else if (s === 3) {
      p.r(hx + 2, hy - 4, w - 4, 3, hair);
      p.r(hx + 3, hy - 4, 1, 1, hairLight);
      p.r(hx, hy + 1, 1, 3, hair);
      p.r(hx + w - 1, hy + 1, 1, 3, hair);
    } else if (s === 2) {
      p.r(hx, hy + 1, 1, 3, hair);
      p.r(hx + w - 1, hy + 1, 1, 3, hair);
      p.r(hx + w, hy + 2, 2, 5, hair);
    } else {
      p.r(hx - 1, hy, 1, 4, hair);
      p.r(hx + w, hy, 1, 4, hair);
    }
    if (s !== 2 && s !== 3) p.r(hx + 1, hy + 2, w - 3, 1, hair);
  } else {
    p.r(hx, hy + 1, 1, 3, hair);
    p.r(hx + w - 1, hy + 1, 1, 3, hair);
    if (s === 1) p.r(hx, hy + 2, 4, 1, hair);
    if (s === 2) {
      p.r(hx + 1, hy - 2, w - 2, 1, mix(hair, look.skin, 0.45));
      p.r(hx, hy - 1, w, 2, mix(hair, look.skin, 0.35));
    }
    if (s === 3) {
      p.r(hx - 1, hy - 2, w + 2, 4, hair);
      p.r(hx - 1, hy + 2, 2, 2, hair);
      p.r(hx + w - 1, hy + 2, 2, 2, hair);
    }
    if (s === 5) {
      p.r(hx + 1, hy - 1, w - 2, 1, mix(hair, look.skin, 0.7));
      p.r(hx + 2, hy - 2, w - 4, 1, mix(hair, look.skin, 0.8));
    }
  }
}

function headFront(p: Pen, look: Look, hx: number, hy: number, rig: Rig): void {
  const w = 8;
  p.r(hx, hy, w, 8, look.skin);
  p.r(hx, hy + 5, w, 3, look.skin);
  p.r(hx + 1, hy + 8, w - 2, 1, look.skinShade);
  p.r(hx - 1, hy + 3, 1, 2, look.skinShade);
  p.r(hx + w, hy + 3, 1, 2, look.skinShade);
  if (look.beard) {
    p.r(hx, hy + 5, w, 3, look.hair);
    p.r(hx + 2, hy + 5, w - 4, 1, look.skin);
    p.r(hx + 3, hy + 3, 2, 1, look.skin);
  } else {
    if (rig.yawn) p.r(hx + 3, hy + 5, 2, 3, '#5a1f24');
    else p.r(hx + 3, hy + 6, 2, 1, mix(look.skin, '#8a3a3a', 0.4));
  }
  if (rig.eyesClosed) {
    p.r(hx + 1, hy + 4, 2, 1, '#2a2320');
    p.r(hx + w - 3, hy + 4, 2, 1, '#2a2320');
  } else {
    p.r(hx + 1, hy + 3, 2, 2, '#ffffff');
    p.r(hx + w - 3, hy + 3, 2, 2, '#ffffff');
    p.r(hx + 2, hy + 3, 1, 2, '#2a2320');
    p.r(hx + w - 3, hy + 3, 1, 2, '#2a2320');
  }
  if (look.glasses) {
    p.r(hx, hy + 2, 4, 1, '#20242c');
    p.r(hx + w - 4, hy + 2, 4, 1, '#20242c');
    p.r(hx, hy + 5, 4, 1, '#20242c');
    p.r(hx + w - 4, hy + 5, 4, 1, '#20242c');
    p.r(hx + 3, hy + 3, 2, 1, '#20242c');
  }
  hairFront(p, look, hx, hy, w);
}

function headBack(p: Pen, look: Look, hx: number, hy: number): void {
  const w = 8;
  const long = look.gender === 'f' && (look.hairStyle === 0 || look.hairStyle === 4);
  p.r(hx, hy - 1, w, 10, look.hair);
  p.r(hx + 1, hy - 2, w - 2, 1, look.hair);
  p.r(hx + 1, hy - 1, 3, 1, look.hairLight);
  p.r(hx + 1, hy + 4, w - 2, 1, look.hairShade);
  p.r(hx + 3, hy + 8, 2, 1, look.skinShade);
  if (!long) {
    p.r(hx + 1, hy + 8, w - 2, 2, look.skin);
    p.r(hx + 1, hy + 8, w - 2, 1, look.hairShade);
  } else {
    p.r(hx - 1, hy + 1, 2, 13, look.hair);
    p.r(hx + w - 1, hy + 1, 2, 13, look.hair);
    p.r(hx + 1, hy + 9, w - 2, 5, look.hair);
    p.r(hx + 2, hy + 11, w - 4, 1, look.hairShade);
  }
  if (look.gender === 'f' && look.hairStyle === 3) p.r(hx + 2, hy - 4, w - 4, 3, look.hair);
  if (look.gender === 'f' && look.hairStyle === 2) p.r(hx + 3, hy + 5, 2, 8, look.hair);
  if (look.gender === 'm' && look.hairStyle === 3) {
    p.r(hx - 1, hy - 2, w + 2, 6, look.hair);
  }
  if (look.gender === 'm' && look.hairStyle === 5) p.r(hx + 2, hy, w - 4, 3, mix(look.hair, look.skin, 0.65));
}

function headSide(p: Pen, look: Look, hx: number, hy: number, rig: Rig): void {
  const w = 7;
  p.r(hx, hy, w, 9, look.skin);
  p.r(hx + w, hy + 4, 1, 2, look.skin);
  p.r(hx + 2, hy + 3, 1, 2, look.skinShade);
  if (rig.eyesClosed) p.r(hx + w - 3, hy + 4, 2, 1, '#2a2320');
  else {
    p.r(hx + w - 3, hy + 3, 2, 2, '#ffffff');
    p.r(hx + w - 2, hy + 3, 1, 2, '#2a2320');
  }
  p.r(hx + w - 2, hy + 7, 2, 1, mix(look.skin, '#8a3a3a', 0.4));
  if (look.beard) p.r(hx + 2, hy + 6, w - 2, 3, look.hair);
  if (look.glasses) {
    p.r(hx + w - 4, hy + 2, 4, 1, '#20242c');
    p.r(hx + w - 4, hy + 5, 4, 1, '#20242c');
  }
  const f = look.gender === 'f';
  p.r(hx - 1, hy - 1, w, 4, look.hair);
  p.r(hx, hy - 2, w - 1, 1, look.hair);
  p.r(hx + 1, hy - 1, 3, 1, look.hairLight);
  p.r(hx + w - 2, hy, 3, 1, look.hair);
  const s = look.hairStyle;
  if (f && (s === 0 || s === 4)) p.r(hx - 2, hy, 4, 13, look.hair);
  else if (f && s === 1) p.r(hx - 1, hy, 3, 8, look.hair);
  else if (f && s === 2) {
    p.r(hx - 1, hy, 2, 5, look.hair);
    p.r(hx - 3, hy + 3, 2, 7, look.hair);
  } else if (f && s === 3) {
    p.r(hx, hy - 4, 5, 3, look.hair);
    p.r(hx - 1, hy, 2, 5, look.hair);
  } else p.r(hx - 1, hy, 3, 6, look.hair);
  if (!f && s === 2) p.r(hx, hy - 1, w, 2, mix(look.hair, look.skin, 0.4));
  if (!f && s === 3) p.r(hx - 2, hy - 2, w + 1, 5, look.hair);
}

function torsoColor(look: Look): { body: string; dark: string; light: string } {
  const body = look.jacket ?? look.shirt;
  return { body, dark: shade(body, -0.25), light: shade(body, 0.2) };
}

function arm(
  p: Pen,
  look: Look,
  kind: ArmPose,
  side: 'near' | 'far' | 'L' | 'R',
  view: 'front' | 'back' | 'side',
  x: number,
  by: number,
  sit: number,
): void {
  const c = torsoColor(look);
  const sleeve = look.jacket ?? look.shirt;
  const hand = look.skin;
  const dir = side === 'L' || side === 'far' ? -1 : 1;
  const y = 15 + by + sit;
  const ax = x;
  const out = (dx: number): number => ax + dir * dx;
  const px = (v: number, w: number): number => (dir < 0 ? v - w + 1 : v);
  switch (kind) {
    case 'down':
    case 'swingF':
    case 'swingB': {
      const off = kind === 'swingF' ? -1 : kind === 'swingB' ? 1 : 0;
      p.r(px(ax, 2), y + off, 2, 7, sleeve);
      p.r(px(ax, 2), y + off + 7, 2, 2, hand);
      p.r(px(ax, 1) + (dir > 0 ? 0 : 0), y + off, 1, 7, c.light);
      break;
    }
    case 'lap': {
      p.r(px(ax, 2), y, 2, 5, sleeve);
      p.r(px(out(-1), 3), y + 5, 3, 2, sleeve);
      p.r(px(out(-3), 2), y + 6, 2, 2, hand);
      break;
    }
    case 'forward': {
      p.r(px(ax, 2), y, 2, 4, sleeve);
      if (view === 'back') {
        p.r(px(out(0), 2), y - 4, 2, 5, sleeve);
        p.r(px(out(0), 2), y - 6, 2, 2, hand);
      } else {
        p.r(px(ax, 2), y + 4, 2, 3, sleeve);
        p.r(px(out(-1), 3), y + 6, 3, 2, hand);
      }
      break;
    }
    case 'typeA':
    case 'typeB': {
      const hi = kind === 'typeA' ? 1 : 0;
      p.r(px(ax, 2), y, 2, 4, sleeve);
      p.r(px(out(-1), 3), y - 3 + hi, 2, 5, sleeve);
      p.r(px(out(-1), 3), y - 5 + hi, 3, 2, hand);
      break;
    }
    case 'cup': {
      p.r(px(ax, 2), y, 2, 4, sleeve);
      p.r(px(out(-2), 4), y + 2, 4, 2, sleeve);
      p.r(px(out(-3), 2), y, 2, 3, hand);
      p.r(px(out(-5), 3), y - 2, 3, 4, '#f4efe2');
      p.r(px(out(-5), 3), y - 2, 3, 1, '#6b4429');
      break;
    }
    case 'mouth': {
      p.r(px(ax, 2), y, 2, 3, sleeve);
      p.r(px(out(-1), 3), y - 2, 2, 4, sleeve);
      p.r(px(out(-2), 2), y - 6, 2, 2, hand);
      break;
    }
    case 'up': {
      p.r(px(ax, 2), y - 2, 2, 5, sleeve);
      p.r(px(out(0), 2), y - 9, 2, 8, sleeve);
      p.r(px(out(0), 2), y - 11, 2, 2, hand);
      break;
    }
    case 'raised': {
      p.r(px(ax, 2), y - 1, 2, 4, sleeve);
      p.r(px(out(0), 2), y - 9, 2, 9, sleeve);
      p.r(px(out(0), 2), y - 12, 3, 3, hand);
      break;
    }
    case 'head': {
      p.r(px(ax, 2), y - 1, 2, 3, sleeve);
      p.r(px(out(1), 3), y - 4, 3, 2, sleeve);
      p.r(px(out(-1), 3), y - 8, 3, 4, sleeve);
      p.r(px(out(-2), 2), y - 9, 2, 2, hand);
      break;
    }
    case 'out': {
      p.r(px(ax, 2), y, 2, 3, sleeve);
      p.r(px(out(1), 3), y + 1, 3, 2, sleeve);
      p.r(px(out(3), 2), y, 2, 3, hand);
      break;
    }
    case 'chin': {
      p.r(px(ax, 2), y, 2, 3, sleeve);
      p.r(px(out(-1), 3), y - 3, 2, 4, sleeve);
      p.r(px(out(-1), 3), y - 5, 3, 2, hand);
      break;
    }
    case 'scratch': {
      p.r(px(ax, 2), y - 1, 2, 4, sleeve);
      p.r(px(out(0), 2), y - 9, 2, 8, sleeve);
      p.r(px(out(-1), 4), y - 12, 4, 2, hand);
      break;
    }
    case 'point': {
      p.r(px(ax, 2), y, 2, 3, sleeve);
      p.r(px(out(1), 6), y - 1, 6, 2, sleeve);
      p.r(px(out(7), 3), y - 2, 3, 2, hand);
      break;
    }
    case 'waveA':
    case 'waveB': {
      const sway = kind === 'waveA' ? 0 : 2;
      p.r(px(ax, 2), y - 1, 2, 4, sleeve);
      p.r(px(out(0), 2), y - 9, 2, 9, sleeve);
      p.r(px(out(sway - 1), 4), y - 12, 4, 3, hand);
      break;
    }
    case 'clapA':
    case 'clapB': {
      const gap = kind === 'clapA' ? 3 : 0;
      p.r(px(ax, 2), y, 2, 3, sleeve);
      p.r(px(out(-1 - gap), 3), y + 1, 3, 2, sleeve);
      p.r(px(out(-3 - gap), 2), y, 2, 3, hand);
      break;
    }
    case 'shakeA':
    case 'shakeB': {
      const lift = kind === 'shakeA' ? 0 : 1;
      p.r(px(ax, 2), y, 2, 3, sleeve);
      p.r(px(out(1), 5), y + 1 - lift, 5, 2, sleeve);
      p.r(px(out(6), 3), y - lift, 3, 3, hand);
      break;
    }
    case 'doc': {
      p.r(px(ax, 2), y, 2, 4, sleeve);
      p.r(px(out(-2), 3), y + 1, 3, 2, sleeve);
      p.r(px(out(-4), 2), y - 1, 2, 3, hand);
      break;
    }
    case 'tap': {
      p.r(px(ax, 2), y, 2, 5, sleeve);
      p.r(px(out(-1), 3), y + 5, 3, 2, sleeve);
      p.r(px(out(-3), 2), y + 4, 2, 2, hand);
      break;
    }
    case 'gesture': {
      p.r(px(ax, 2), y, 2, 3, sleeve);
      p.r(px(out(1), 3), y - 2, 3, 3, sleeve);
      p.r(px(out(2), 3), y - 5, 3, 3, hand);
      break;
    }
  }
}

function legs(p: Pen, look: Look, rig: Rig, view: 'front' | 'back' | 'side'): void {
  const by = rig.bob;
  if (rig.legs === 'hidden') return;
  const pants = look.bottom;
  const pantsDark = shade(pants, -0.22);
  const shoes = look.shoes;
  const yTop = 23 + by;
  if (look.skirt) {
    p.r(7, yTop - 2, 10, 6, pants);
    p.r(7, yTop + 3, 10, 1, pantsDark);
    p.r(8, yTop - 2, 1, 5, shade(pants, 0.15));
  }
  if (rig.legs === 'sit') {
    p.r(8, 24, 8, 3, look.skirt && look.bareLegs ? look.skin : pants);
    p.r(8, 27, 4, 3, look.skirt && look.bareLegs ? look.skin : pants);
    p.r(12, 27, 4, 3, look.skirt && look.bareLegs ? look.skin : pants);
    p.r(8, 30, 4, 2, shoes);
    p.r(12, 30, 4, 2, shoes);
    return;
  }
  const raiseL = rig.legs === 'stepL' ? 2 : 0;
  const raiseR = rig.legs === 'stepR' ? 2 : 0;
  const bare = look.skirt && look.bareLegs;
  const legColor = bare ? look.skin : pants;
  const legTop = look.skirt ? yTop + 3 : yTop;
  if (view === 'side') {
    const fwd = rig.legs === 'stepL' ? 2 : rig.legs === 'stepR' ? -2 : 0;
    p.r(10 - fwd, legTop, 3, 8 - (legTop - yTop), legColor);
    p.r(10 - fwd - (fwd < 0 ? 0 : 0), 30 + by - 1, 4, 2, shoes);
    p.r(12 + fwd, legTop, 3, 8 - (legTop - yTop) - (fwd !== 0 ? 1 : 0), shade(legColor, -0.12));
    p.r(12 + fwd + 1, 30 + by - 1 - (fwd !== 0 ? 1 : 0), 4, 2, shoes);
    return;
  }
  p.r(9, legTop - raiseL, 3, 7 - (legTop - yTop) + raiseL, legColor);
  p.r(12, legTop - raiseR, 3, 7 - (legTop - yTop) + raiseR, bare ? look.skin : pantsDark);
  p.r(8, 30 + by - 1 - raiseL, 4, 2, shoes);
  p.r(12, 30 + by - 1 - raiseR, 4, 2, shoes);
  if (!bare && !look.skirt) p.r(11, yTop + 2, 2, 5, shade(pants, -0.35));
}

function torso(p: Pen, look: Look, rig: Rig, view: 'front' | 'back' | 'side'): void {
  const c = torsoColor(look);
  const y = 13 + rig.bob + rig.sit;
  const x = view === 'side' ? 9 : 8;
  const w = view === 'side' ? 7 : 8;
  p.r(x - (view === 'side' ? 0 : 1), y, w + (view === 'side' ? 0 : 2), 2, c.light);
  p.r(x, y + 2, w, 9 - 2, c.body);
  p.r(x, y + 9, w, 2, look.jacket ? c.dark : look.bottom);
  p.r(x, y + 10, w, 1, shade(look.jacket ?? look.bottom, -0.4));
  if (view === 'front') {
    if (look.jacket) {
      p.r(x + 2, y, 4, 4, look.shirt);
      p.r(x + 1, y + 1, 1, 6, c.dark);
      p.r(x + w - 2, y + 1, 1, 6, c.dark);
      p.r(x + 3, y + 4, 2, 6, look.shirt);
      if (look.tie) {
        p.r(x + 3, y + 1, 2, 1, look.tie);
        p.r(x + 3, y + 2, 2, 6, look.tie);
        p.r(x + 3, y + 8, 2, 1, shade(look.tie, -0.3));
      } else if (look.gender === 'f') {
        p.r(x + 3, y, 2, 2, look.skin);
      }
      p.r(x + 3, y + 9, 2, 1, BUTTON);
    } else {
      p.r(x + 3, y, 2, 2, look.skin);
      if (look.tie) {
        p.r(x + 3, y + 2, 2, 7, look.tie);
        p.r(x + 3, y + 8, 2, 1, shade(look.tie, -0.3));
      }
      p.r(x + 1, y + 3, 1, 5, c.dark);
    }
    if (look.badge) {
      p.r(x + w - 3, y + 4, 3, 4, '#2f6fed');
      p.r(x + w - 3, y + 4, 3, 1, '#ffffff');
      p.r(x + w - 4, y + 2, 1, 2, '#9ab8f5');
    }
  } else if (view === 'back') {
    p.r(x + 3, y + 3, 2, 7, c.dark);
    p.r(x, y + 2, w, 1, c.light);
    if (look.badge) p.r(x + 1, y + 1, 2, 1, '#2f6fed');
  } else if (look.badge) {
    p.r(x + w - 1, y + 4, 2, 3, '#2f6fed');
  }
  p.r(x + 3, y - 1, 2, 2, look.skin);
}

const BUTTON = '#1a1a1a';

function props(p: Pen, rig: Rig, view: 'front' | 'back' | 'side'): void {
  if (rig.prop === 'popcorn') {
    p.r(9, 22 + rig.sit, 6, 5, '#d8433f');
    p.r(9, 22 + rig.sit, 6, 1, '#ffffff');
    p.r(10, 21 + rig.sit, 1, 1, '#fff2c4');
    p.r(12, 20 + rig.sit, 2, 2, '#fff2c4');
    p.r(11, 21 + rig.sit, 1, 1, '#ffe9a0');
  } else if (rig.prop === 'paddle') {
    p.r(18, 14, 1, 5, '#7a4a26');
    p.r(17, 11, 3, 3, '#d8433f');
  } else if ((rig.prop === 'doc' || rig.prop === 'docFlip') && view !== 'back') {
    const flip = rig.prop === 'docFlip';
    p.r(flip ? 7 : 8, 15 + rig.sit - 1, flip ? 10 : 8, 8, '#f4efe2');
    p.r(flip ? 7 : 8, 15 + rig.sit - 1, flip ? 10 : 8, 1, '#c9c2b0');
    for (let line = 0; line < 3; line++) p.r(10, 17 + rig.sit + line * 2, flip ? 5 : 4, 1, '#8a8473');
  } else if (rig.prop === 'book') {
    p.r(9, 20, 6, 4, '#8a5a2b');
    p.r(10, 21, 4, 2, '#f4efe2');
  } else if (rig.prop === 'stick' && view !== 'side') {
    p.r(11, 20, 2, 2, '#ff4a4a');
  }
}

/** Draw one frame of a person into a fresh sprite canvas (24x34, feet anchored at (12, 32)). */
export function drawPerson(look: Look, pose: Pose, dir: Dir, frame: number): HTMLCanvasElement {
  const canvas = makeCanvas(SPRITE_W, SPRITE_H);
  const ctx = context2d(canvas);
  const rig = rigFor(pose, frame, dir);
  const flip = dir === 'w';
  const p = new Pen(ctx, flip);
  const view: 'front' | 'back' | 'side' = dir === 'n' ? 'back' : dir === 's' ? 'front' : 'side';
  const hy = 4 + rig.bob + rig.sit + rig.headDy;
  const hx = (view === 'side' ? 9 : 8) + rig.headDx;

  if (view === 'side') {
    if (look.gender === 'f' && (look.hairStyle === 0 || look.hairStyle === 4))
      p.r(hx - 2, hy + 4, 4, 14, look.hairShade);
    legs(p, look, rig, view);
    arm(p, look, rig.armL, 'far', view, 10, rig.bob, rig.sit);
    torso(p, look, rig, view);
    headSide(p, look, hx, hy, rig);
    arm(p, look, rig.armR, 'near', view, 11, rig.bob, rig.sit);
    props(p, rig, view);
  } else {
    if (view === 'front' && look.gender === 'f' && (look.hairStyle === 0 || look.hairStyle === 4))
      p.r(hx - 1, hy + 6, 10, 10, look.hairShade);
    legs(p, look, rig, view);
    torso(p, look, rig, view);
    arm(p, look, rig.armL, 'L', view, 6, rig.bob, rig.sit);
    arm(p, look, rig.armR, 'R', view, 17, rig.bob, rig.sit);
    if (view === 'front') headFront(p, look, hx, hy, rig);
    else headBack(p, look, hx, hy);
    props(p, rig, view);
  }
  return canvas;
}
