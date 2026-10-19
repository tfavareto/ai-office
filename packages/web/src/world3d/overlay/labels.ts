// 2D canvas overlay above the WebGL canvas: name tags, speech bubbles, alert badges and the first-person prompt. Sprites
// are cached per text so a frame is just a few drawImage calls.
import type { AgentStatus } from '@ai-office/shared';

export interface TagItem {
  id: string;
  sx: number;
  sy: number;
  name: string;
  accent: string;
  status: AgentStatus;
  sub: boolean;
  emphasis: boolean;
  alert: boolean;
  bubble: { text: string; icon: string; sticky: boolean } | null;
}

const STATUS_COLOR: Record<AgentStatus, string> = { working: '#3ecf8e', waiting: '#ffbe3c', idle: '#8d99ad', done: '#6ea2ff', offline: '#5a6372' };
const FONT = '"Inter", "SF Pro Text", system-ui, sans-serif';

interface Sprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class LabelOverlay {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private readonly cache = new Map<string, Sprite>();

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.cache.clear();
  }

  private sprite(key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): Sprite {
    let s = this.cache.get(key);
    if (!s) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * this.dpr);
      canvas.height = Math.ceil(h * this.dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(this.dpr, this.dpr);
      paint(ctx);
      s = { canvas, w, h };
      if (this.cache.size > 400) this.cache.clear();
      this.cache.set(key, s);
    }
    return s;
  }

  private measure(font: string, text: string): number {
    this.ctx.font = font;
    return this.ctx.measureText(text).width;
  }

  private tag(item: TagItem): Sprite {
    const font = `600 11px ${FONT}`;
    const textW = Math.ceil(this.measure(font, item.name));
    const w = textW + 28 + (item.sub ? 30 : 0);
    const h = 20;
    return this.sprite(`tag|${item.name}|${item.accent}|${item.status}|${item.sub}|${item.emphasis}`, w, h, (ctx) => {
      roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 10);
      ctx.fillStyle = item.emphasis ? 'rgba(20,28,44,0.94)' : 'rgba(14,19,30,0.74)';
      ctx.fill();
      ctx.strokeStyle = item.emphasis ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.14)';
      ctx.stroke();
      ctx.fillStyle = item.accent;
      ctx.beginPath();
      ctx.arc(10, h / 2, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = STATUS_COLOR[item.status];
      ctx.beginPath();
      ctx.arc(w - 9, h / 2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = font;
      ctx.fillStyle = '#f2f5fa';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.name, 18, h / 2 + 0.5);
      if (item.sub) {
        ctx.fillStyle = '#7a5cc7';
        roundRect(ctx, w - 40, 4, 26, 12, 6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `700 8px ${FONT}`;
        ctx.fillText('SUB', w - 36, h / 2 + 0.5);
      }
    });
  }

  private bubble(b: NonNullable<TagItem['bubble']>): Sprite {
    const font = `500 12px ${FONT}`;
    const textW = Math.ceil(this.measure(font, b.text));
    const w = Math.min(230, textW + 40);
    const h = 26;
    return this.sprite(`bub|${b.text}|${b.icon}|${b.sticky}`, w, h + 7, (ctx) => {
      roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 9);
      ctx.fillStyle = b.sticky ? '#ffd23c' : '#f7f4ec';
      ctx.fill();
      ctx.strokeStyle = b.sticky ? '#c28a00' : 'rgba(0,0,0,0.18)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w / 2 - 5, h - 1);
      ctx.lineTo(w / 2, h + 6);
      ctx.lineTo(w / 2 + 5, h - 1);
      ctx.closePath();
      ctx.fillStyle = b.sticky ? '#ffd23c' : '#f7f4ec';
      ctx.fill();
      ctx.font = `13px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1b2230';
      ctx.fillText(b.icon, 7, h / 2 + 1);
      ctx.font = font;
      let text = b.text;
      while (text.length > 3 && ctx.measureText(text).width > w - 34) text = text.slice(0, -2);
      ctx.fillText(text === b.text ? text : `${text}…`, 26, h / 2 + 0.5);
    });
  }

  draw(items: readonly TagItem[], showNames: boolean, hint: string | null): void {
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const item of items) {
      let y = item.sy - 6;
      if (showNames || item.emphasis) {
        const t = this.tag(item);
        ctx.drawImage(t.canvas, Math.round((item.sx - t.w / 2) * dpr), Math.round((y - t.h) * dpr), t.canvas.width, t.canvas.height);
        y -= t.h + 3;
      }
      if (item.bubble) {
        const b = this.bubble(item.bubble);
        ctx.drawImage(b.canvas, Math.round((item.sx - b.w / 2) * dpr), Math.round((y - b.h) * dpr), b.canvas.width, b.canvas.height);
      } else if (item.alert) {
        const b = this.bubble({ text: '!', icon: '', sticky: true });
        ctx.drawImage(b.canvas, Math.round((item.sx - b.w / 2) * dpr), Math.round((y - b.h) * dpr), b.canvas.width, b.canvas.height);
      }
    }
    if (hint) this.drawHint(hint);
  }

  private drawHint(text: string): void {
    const { ctx, dpr } = this;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `600 13px ${FONT}`;
    const tw = ctx.measureText(text).width + 28;
    roundRect(ctx, w / 2 - tw / 2, h / 2 + 46, tw, 28, 14);
    ctx.fillStyle = 'rgba(14,19,30,0.82)';
    ctx.fill();
    ctx.fillStyle = '#f2f5fa';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 61);
    ctx.textAlign = 'left';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fill();
  }

  /** Draws the first-person minimap (floor plan with people) in the corner. */
  drawMinimap(paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): void {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, this.canvas.width / dpr, this.canvas.height / dpr);
  }
}
