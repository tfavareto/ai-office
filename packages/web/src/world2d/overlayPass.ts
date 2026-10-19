import { TILE } from '../layout/constants';
import type { Character } from '../sim/types';
import type { Bubble } from '../sim/bubbles';
import { FOOT_OFFSET } from './picking';
import type { OverlaySprites, Sprite } from './overlay';
import type { FrameState } from './renderer';
import { STATUS_COLORS } from './palette';

const HEAD_HEIGHT = 27;
const FADE_IN = 0.18;
const FADE_OUT = 0.35;

function statusOf(c: Character): string {
  if (c.status === 'working' && c.agent.shells.some((s) => !s.background && s.kind === 'shell')) return 'shell';
  return c.status;
}

function draw(ctx: CanvasRenderingContext2D, s: Sprite, cx: number, y: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  ctx.drawImage(s.canvas, Math.round(cx - s.w / 2), Math.round(y), s.w, s.h);
  ctx.globalAlpha = 1;
}

function bubbleAlpha(b: Bubble, now: number): number {
  const born = Math.min(1, (now - b.shownAt) / FADE_IN);
  const left = b.endsAt === Infinity ? 1 : Math.min(1, (b.endsAt - now) / FADE_OUT);
  return Math.max(0, Math.min(born, left));
}

/** Screen-space pass: name tags, speech bubbles, status badges, room labels and the selected room outline. */
export function drawOverlay(ctx: CanvasRenderingContext2D, sprites: OverlaySprites, s: FrameState): void {
  const { cam, sim } = s;
  const dpr = cam.dpr;
  sprites.setDpr(dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 1;
  const w = cam.view.width;
  const h = cam.view.height;

  drawRooms(ctx, sprites, s);

  const bubbles = new Map<string, Bubble>();
  for (const b of sim.bubbles) bubbles.set(b.agentId, b);

  const people = sim.characters.filter((c) => c.alpha > 0.35).sort((a, b) => a.y - b.y);
  for (const c of people) {
    const head = cam.worldToScreen(c.x * TILE, c.y * TILE + FOOT_OFFSET - HEAD_HEIGHT + (c.seat ? 4 : 0));
    if (head.x < -80 || head.x > w + 80 || head.y < -60 || head.y > h + 60) continue;
    const selected = s.selection?.type === 'agent' && s.selection.id === c.agentId;
    const hovered = s.hover.agentId === c.agentId;
    const status = statusOf(c);
    let top = head.y - 4;
    const showTag = s.options.showNames && (cam.zoom >= 1 || selected || hovered || c.alert);
    if (showTag || selected || hovered) {
      const tag = sprites.nameTag(c.name, s.accountColor(c.accountId), status, c.kind, selected || hovered);
      top -= tag.h;
      draw(ctx, tag, head.x, top, c.alpha);
    }
    if (c.alert) {
      const pulse = s.options.reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(s.time * 6);
      const badge = sprites.badge('!', STATUS_COLORS.waiting);
      draw(ctx, badge, head.x + 11 * Math.min(cam.zoom, 2) * 0.6 + 8, head.y + 2 - badge.h * pulse * 0.5, c.alpha);
    } else if (c.pose === 'sleep') {
      const bob = s.options.reducedMotion ? 0 : Math.sin(s.time * 2) * 2;
      draw(ctx, sprites.badge('z', '#9fb4e8'), head.x + 12, head.y - 6 + bob, c.alpha * 0.9);
    }
    const bubble = bubbles.get(c.agentId);
    if (bubble) {
      const alpha = bubbleAlpha(bubble, sim.time) * c.alpha;
      if (alpha > 0.02) {
        const tone = bubble.sticky ? 'alert' : bubble.importance >= 60 && bubble.icon === '✅' ? 'good' : 'normal';
        const sprite = sprites.bubble(bubble.text, bubble.icon, tone);
        const rise = (1 - Math.min(1, (sim.time - bubble.shownAt) / FADE_IN)) * 5;
        draw(ctx, sprite, head.x, top - sprite.h - 1 + rise, alpha);
      }
    }
  }
  ctx.imageSmoothingEnabled = false;
}

function drawRooms(ctx: CanvasRenderingContext2D, sprites: OverlaySprites, s: FrameState): void {
  const { cam, sim } = s;
  const selectedRoom = s.selection?.type === 'room' ? s.selection.id : null;
  for (const area of sim.building.areas) {
    const isProject = area.kind === 'project';
    const room = isProject ? sim.rooms.byArea(area.id) : undefined;
    if (isProject && (!room || room.ghost)) continue;
    const projectId = area.projectId ?? '';
    const emphasis = isProject && (projectId === selectedRoom || projectId === s.hover.roomId);
    const overview = cam.zoom <= 0.5;
    if (!overview && !emphasis) continue;
    const topLeft = cam.worldToScreen(area.rect.x * TILE, area.rect.y * TILE);
    const size = { w: area.rect.w * TILE * cam.zoom, h: area.rect.h * TILE * cam.zoom };
    if (topLeft.x > cam.view.width || topLeft.y > cam.view.height || topLeft.x + size.w < 0 || topLeft.y + size.h < 0) continue;
    if (emphasis && projectId === selectedRoom) {
      ctx.strokeStyle = 'rgba(160,195,255,0.95)';
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(80,140,255,0.8)';
      ctx.shadowBlur = 10;
      ctx.strokeRect(topLeft.x + 1, topLeft.y + 1, size.w - 2, size.h - 2);
      ctx.shadowBlur = 0;
    } else if (emphasis) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(topLeft.x + 1, topLeft.y + 1, size.w - 2, size.h - 2);
    }
    const info = s.roomInfo.get(projectId);
    const detail = isProject && info ? `${info.agents} ${info.agents === 1 ? 'agente' : 'agentes'}` : '';
    const label = sprites.roomLabel(area.label, detail, area.theme.accent);
    const labelAlpha = isProject ? 1 : 0.7;
    ctx.globalAlpha = labelAlpha * (room ? Math.min(1, room.progress * 2) : 1);
    ctx.drawImage(label.canvas, Math.round(topLeft.x + size.w / 2 - label.w / 2), Math.round(topLeft.y + 6 * cam.zoom), label.w, label.h);
    ctx.globalAlpha = 1;
  }
}
