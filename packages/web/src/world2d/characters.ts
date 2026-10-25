import { TILE } from '../layout/constants';
import type { Rect } from '../layout/types';
import { characterFrame } from './chars/cache';
import { ANCHOR_X, ANCHOR_Y, SPRITE_W, frameFor } from './chars/sprites';
import { rgba } from './color';
import type { AreaCanvas, PlacedItem } from './layers/areaLayer';
import { type Ctx, context2d, ellipse, makeCanvas } from './paint/ctx';
import { FOOT_OFFSET } from './picking';
import { jumpLift } from '../sim/confettiPlan';
import type { Character } from '../sim/types';
import type { FrameState, Renderer } from './renderer';
import { drawActivityFx, type FxContext } from './fx/activityFx';

/** Height (world px) of the jump of a celebrating person. */
const JUMP_PX = 7;

const rings = new Map<string, HTMLCanvasElement>();
let shadow: HTMLCanvasElement | null = null;

function shadowSprite(): HTMLCanvasElement {
  if (!shadow) {
    shadow = makeCanvas(16, 7);
    const ctx = context2d(shadow);
    ellipse(ctx, 8, 3, 6, 2, 'rgba(8,10,18,0.16)');
    ellipse(ctx, 8, 3, 5, 2, 'rgba(8,10,18,0.22)');
  }
  return shadow;
}

/** Thin elliptical ring at the feet in the account colour (pixel-art, 1 px stroke). */
function ringSprite(color: string, width: number): HTMLCanvasElement {
  const key = `${color}|${width}`;
  let canvas = rings.get(key);
  if (!canvas) {
    canvas = makeCanvas(width + 2, 9);
    const ctx = context2d(canvas);
    const rx = width / 2;
    const cx = (width + 2) / 2;
    ctx.fillStyle = color;
    for (let a = 0; a < 360; a += 4) {
      const x = Math.round(cx + Math.cos((a * Math.PI) / 180) * rx - 0.5);
      const y = Math.round(4 + Math.sin((a * Math.PI) / 180) * 2.4 - 0.5);
      ctx.fillRect(x, y, 1, 1);
    }
    rings.set(key, canvas);
  }
  return canvas;
}

function overlapsTall(p: PlacedItem, left: number, top: number, right: number, bottom: number): boolean {
  return p.x < right && p.x + p.sprite.width > left && p.y < bottom && p.y + p.sprite.height > top;
}

/** People sorted by depth, each followed by a redraw of the tall furniture standing in front of them. */
export function drawCharacters(ctx: Ctx, renderer: Renderer, s: FrameState, ordered: AreaCanvas[], vis: Rect): void {
  const people = s.sim.characters
    .filter((c) => c.alpha > 0.02)
    .filter((c) => {
      const x = c.x * TILE;
      const y = c.y * TILE;
      return x > vis.x - 16 && x < vis.x + vis.w + 16 && y > vis.y - 8 && y < vis.y + vis.h + 40;
    })
    .sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));

  const tall: PlacedItem[] = [];
  for (const ac of ordered) {
    if (ac.x > vis.x + vis.w || ac.x + ac.w < vis.x || ac.y - 24 > vis.y + vis.h || ac.y + ac.h < vis.y) continue;
    tall.push(...ac.tall);
  }

  const pulse = 0.65 + 0.35 * Math.sin(s.time * 4);
  for (const c of people) {
    const look = renderer.lookOf(c.agent);
    const sprite = characterFrame(look, c.pose, c.dir, frameFor(c.pose, c.poseT, c.walkPhase));
    const fx = Math.round(c.x * TILE);
    const fy = Math.round(c.y * TILE + FOOT_OFFSET);
    ctx.globalAlpha = c.alpha;
    const standing = c.seat === null;
    if (standing) ctx.drawImage(shadowSprite(), fx - 8, fy - 4);
    const selected = s.selection?.type === 'agent' && s.selection.id === c.agentId;
    const hovered = s.hover.agentId === c.agentId;
    ctx.drawImage(ringSprite(s.accountColor(c.accountId), 14), fx - 8, fy - 4 - (standing ? 0 : 1));
    if (selected || hovered) {
      ctx.globalAlpha = c.alpha * (selected ? pulse : 0.7);
      ctx.drawImage(ringSprite(selected ? '#ffffff' : rgba('#ffffff', 0.8), 20), fx - 11, fy - 4);
      ctx.globalAlpha = c.alpha;
    }
    const lift = c.celebrating && c.pose === 'celebrate' ? Math.round(jumpLift(c.poseT, JUMP_PX)) : 0;
    ctx.drawImage(sprite, fx - ANCHOR_X, fy - ANCHOR_Y - lift);
    ctx.globalAlpha = 1;
    const left = fx - ANCHOR_X;
    const top = fy - ANCHOR_Y;
    const right = left + SPRITE_W;
    const bottom = fy + 1;
    for (const p of tall) {
      if (p.bottom <= fy - 1 || !overlapsTall(p, left, top, right, bottom)) continue;
      ctx.drawImage(p.sprite, p.x, p.y);
    }
  }
  drawEffects(ctx, s, people);
}

/** What each person is up to, drawn above everything: code glyphs, thought bubbles, pulses, sparkles. */
function drawEffects(ctx: Ctx, s: FrameState, people: readonly Character[]): void {
  const meeting = s.sim.building.areas.find((a) => a.id === 'meeting');
  const f: FxContext = {
    time: s.time,
    reducedMotion: s.options.reducedMotion,
    meetingX: meeting ? (meeting.rect.x + meeting.rect.w / 2) * TILE : null,
  };
  for (const c of people) {
    if (c.alpha < 0.6) continue;
    drawActivityFx(ctx, c, Math.round(c.x * TILE), Math.round(c.y * TILE + FOOT_OFFSET), f);
  }
}
