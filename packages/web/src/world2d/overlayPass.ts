import { TILE } from '../layout/constants';
import type { Bubble } from '../sim/bubbles';
import type { Character } from '../sim/types';
import {
  BUBBLE_MIN_ZOOM,
  NAME_MIN_ZOOM,
  ROOM_LABEL_MAX_ZOOM,
  bubblesPerRoom,
  placeLabels,
  roomPillSlot,
  type Box,
  type LabelItem,
  type Pos,
} from './labels';
import type { OverlaySprites, Sprite } from './overlay';
import { STATUS_COLORS } from './palette';
import { FOOT_OFFSET } from './picking';
import type { FrameState } from './renderer';

const HEAD_HEIGHT = 27;
const FADE_IN = 0.18;
const FADE_OUT = 0.35;
const LABEL_FADE_RATE = 14;
const LABEL_GAP = 2;
const KEEP_BONUS = 30;
const MAX_BUBBLE_STACK = 3;
const TAG_GAP = 4;
const FREE_MARGIN = 40;

type Layer = 'tag' | 'badge' | 'bubble';
const LAYER_ORDER: readonly Layer[] = ['tag', 'badge', 'bubble'];

const Priority = {
  Selected: 900,
  Hovered: 880,
  AlertBadge: 870,
  AlertTag: 860,
  AlertBubble: 850,
  Bubble: 200,
  Tag: 100,
  Sleep: 60,
} as const;

interface Payload {
  sprite: Sprite;
  alpha: number;
  rise: number;
  layer: Layer;
}

interface Shown extends Payload {
  x: number;
  y: number;
  fade: number;
}

function statusOf(c: Character): string {
  if (c.status === 'working' && c.agent.shells.some((s) => !s.background && s.kind === 'shell')) return 'shell';
  return c.status;
}

function bubbleAlpha(b: Bubble, now: number): number {
  const born = Math.min(1, (now - b.shownAt) / FADE_IN);
  const left = b.endsAt === Infinity ? 1 : Math.min(1, (b.endsAt - now) / FADE_OUT);
  return Math.max(0, Math.min(born, left));
}

/** Spots above a head: first the natural one, then raised, then to the left/right of it. */
function tagSpots(head: Pos, w: number, h: number): Pos[] {
  const top = head.y - TAG_GAP - h;
  return [
    { x: head.x - w / 2, y: top },
    { x: head.x - w / 2, y: top - h - LABEL_GAP },
    { x: head.x + 8, y: top + h * 0.5 },
    { x: head.x - w - 8, y: top + h * 0.5 },
    { x: head.x - w / 2, y: head.y + 22 },
  ];
}

/** Bubble spots: above the name tag (or the head), then beside the head, then stacked higher. */
function bubbleSpots(head: Pos, w: number, h: number, anchor: Box | undefined): Pos[] {
  const base = anchor && anchor.y < head.y ? anchor.y : head.y - TAG_GAP;
  const above = (k: number): Pos => ({ x: head.x - w / 2, y: base - h - 1 - k * (h + LABEL_GAP) });
  const beside = head.y - h;
  const spots: Pos[] = [above(0), { x: head.x + 10, y: beside }, { x: head.x - w - 10, y: beside }];
  for (let k = 1; k <= MAX_BUBBLE_STACK; k++) spots.push(above(k));
  return spots;
}

/**
 * Screen-space pass: room pills, name tags, status badges and speech bubbles. Labels are laid out each frame so that
 * none overlap or get cut off: pills are fixed, everything else is placed by priority (waiting > selected/hovered >
 * bubbles > names) and fades in/out instead of popping.
 */
export class OverlayPass {
  private readonly shown = new Map<string, Shown>();
  private kept = new Set<string>();

  draw(ctx: CanvasRenderingContext2D, sprites: OverlaySprites, s: FrameState): void {
    const { cam } = s;
    const dpr = cam.dpr;
    sprites.setDpr(dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    const screen: Box = { x: 0, y: 0, w: cam.view.width, h: cam.view.height };

    const pills = this.drawRooms(ctx, sprites, s);
    const payloads = new Map<string, Payload>();
    const items = this.buildItems(sprites, s, payloads);
    const placed = placeLabels(items, {
      obstacles: pills,
      clip: screen,
      gap: LABEL_GAP,
      groupLimit: bubblesPerRoom(cam.zoom),
      kept: this.kept,
      keepBonus: KEEP_BONUS,
    });

    const k = 1 - Math.exp(-s.dt * LABEL_FADE_RATE);
    for (const [id, p] of placed) {
      const payload = payloads.get(id);
      if (!payload) continue;
      const prev = this.shown.get(id);
      this.shown.set(id, { ...payload, x: p.x, y: p.y, fade: prev ? prev.fade + (1 - prev.fade) * k : 0 });
    }
    this.kept = new Set(placed.keys());
    for (const [id, entry] of this.shown) {
      if (placed.has(id)) continue;
      entry.fade -= entry.fade * k;
      if (entry.fade < 0.03) this.shown.delete(id);
    }
    this.paint(ctx);
    ctx.imageSmoothingEnabled = false;
  }

  private paint(ctx: CanvasRenderingContext2D): void {
    for (const layer of LAYER_ORDER) {
      for (const e of this.shown.values()) {
        if (e.layer !== layer) continue;
        const alpha = e.alpha * Math.min(1, e.fade * 1.2);
        if (alpha < 0.02) continue;
        ctx.globalAlpha = alpha;
        ctx.drawImage(e.sprite.canvas, Math.round(e.x), Math.round(e.y + e.rise), e.sprite.w, e.sprite.h);
      }
    }
    ctx.globalAlpha = 1;
  }

  private buildItems(sprites: OverlaySprites, s: FrameState, payloads: Map<string, Payload>): LabelItem[] {
    const { cam, sim } = s;
    const w = cam.view.width;
    const h = cam.view.height;
    const bubbles = new Map<string, Bubble>();
    for (const b of sim.bubbles) bubbles.set(b.agentId, b);
    const items: LabelItem[] = [];

    for (const c of sim.characters) {
      if (c.alpha <= 0.35) continue;
      const head = cam.worldToScreen(c.x * TILE, c.y * TILE + FOOT_OFFSET - HEAD_HEIGHT + (c.seat ? 4 : 0));
      if (head.x < -FREE_MARGIN || head.x > w + FREE_MARGIN || head.y < -FREE_MARGIN || head.y > h + FREE_MARGIN) continue;
      const selected = s.selection?.type === 'agent' && s.selection.id === c.agentId;
      const hovered = s.hover.agentId === c.agentId;
      const showTag = selected || hovered || c.alert || (s.options.showNames && cam.zoom >= NAME_MIN_ZOOM);
      let tagPriority: number = selected ? Priority.Selected : hovered ? Priority.Hovered : c.alert ? Priority.AlertTag : Priority.Tag;
      const tagId = `tag:${c.agentId}`;

      const bubble = bubbles.get(c.agentId);
      const bubbleAlphaNow = bubble ? bubbleAlpha(bubble, sim.time) * c.alpha : 0;
      if (bubble && bubbleAlphaNow > 0.02 && (cam.zoom >= BUBBLE_MIN_ZOOM || bubble.sticky)) {
        const tone = bubble.sticky ? 'alert' : bubble.importance >= 60 && bubble.icon === '✅' ? 'good' : 'normal';
        const sprite = sprites.bubble(bubble.text, bubble.icon, tone);
        const priority = bubble.sticky ? Priority.AlertBubble : selected ? Priority.Selected - 1 : Priority.Bubble + bubble.importance;
        const id = `bub:${c.agentId}`;
        const rise = (1 - Math.min(1, (sim.time - bubble.shownAt) / FADE_IN)) * 5;
        payloads.set(id, { sprite, alpha: bubbleAlphaNow, rise, layer: 'bubble' });
        if (showTag) tagPriority = Math.max(tagPriority, priority + 1);
        items.push({
          id,
          priority,
          w: sprite.w,
          h: sprite.h,
          spots: (anchor) => bubbleSpots(head, sprite.w, sprite.h, anchor),
          anchorId: showTag ? tagId : undefined,
          required: bubble.sticky,
          group: c.areaId ?? 'outside',
        });
      }

      if (showTag) {
        const sprite = sprites.nameTag(c.name, s.accountColor(c.accountId), statusOf(c), c.kind, selected || hovered);
        payloads.set(tagId, { sprite, alpha: c.alpha, rise: 0, layer: 'tag' });
        items.push({ id: tagId, priority: tagPriority, w: sprite.w, h: sprite.h, spots: tagSpots(head, sprite.w, sprite.h), required: selected || hovered || c.alert });
      }

      if (c.alert) {
        const badge = sprites.badge('!', STATUS_COLORS.waiting);
        const pulse = s.options.reducedMotion ? 1 : 0.88 + 0.12 * Math.sin(s.time * 6);
        const side = 11 * Math.min(cam.zoom, 2) * 0.6 + 8;
        const id = `badge:${c.agentId}`;
        payloads.set(id, { sprite: badge, alpha: c.alpha, rise: (1 - pulse) * badge.h * 0.5, layer: 'badge' });
        items.push({
          id,
          priority: Priority.AlertBadge,
          w: badge.w,
          h: badge.h,
          spots: [{ x: head.x + side, y: head.y + 2 - badge.h / 2 }, { x: head.x - side - badge.w, y: head.y + 2 - badge.h / 2 }],
          required: true,
        });
      } else if (c.pose === 'sleep' && cam.zoom >= NAME_MIN_ZOOM) {
        const badge = sprites.badge('z', '#9fb4e8');
        const bob = s.options.reducedMotion ? 0 : Math.sin(s.time * 2) * 2;
        const id = `badge:${c.agentId}`;
        payloads.set(id, { sprite: badge, alpha: c.alpha * 0.9, rise: bob, layer: 'badge' });
        items.push({ id, priority: Priority.Sleep, w: badge.w, h: badge.h, spots: [{ x: head.x + 12 - badge.w / 2, y: head.y - 6 }] });
      }
    }
    return items;
  }

  /** Draws room outlines and pills; returns the pill boxes (obstacles for the other labels). */
  private drawRooms(ctx: CanvasRenderingContext2D, sprites: OverlaySprites, s: FrameState): Box[] {
    const { cam, sim } = s;
    const selectedRoom = s.selection?.type === 'room' ? s.selection.id : null;
    const insets = cam.view.insets;
    const free: Box = {
      x: insets.left,
      y: insets.top,
      w: cam.view.width - insets.left - insets.right,
      h: cam.view.height - insets.top - insets.bottom,
    };
    const pills: Box[] = [];
    for (const area of sim.building.areas) {
      const isProject = area.kind === 'project';
      const room = isProject ? sim.rooms.byArea(area.id) : undefined;
      if (isProject && (!room || room.ghost)) continue;
      const projectId = area.projectId ?? '';
      const emphasis = isProject && (projectId === selectedRoom || projectId === s.hover.roomId);
      if (cam.zoom > ROOM_LABEL_MAX_ZOOM && !emphasis) continue;
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
      const room2 = { x: topLeft.x, y: topLeft.y, w: size.w, h: size.h };
      const slot = roomPillSlot(room2, free, 20, 2 * TILE * cam.zoom);
      if (!slot) continue;
      const label = sprites.roomLabel(area.label, detail, area.theme.accent, slot.maxWidth);
      const x = Math.round(slot.cx - label.w / 2);
      ctx.globalAlpha = (isProject ? 1 : 0.85) * (room ? Math.min(1, room.progress * 2) : 1);
      ctx.drawImage(label.canvas, x, Math.round(slot.y), label.w, label.h);
      ctx.globalAlpha = 1;
      pills.push({ x, y: slot.y, w: label.w, h: label.h });
    }
    return pills;
  }
}
