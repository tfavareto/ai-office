import { ellipsize, fitRoomLabel, type Measure } from './labels';
import { makeCanvas } from './paint/ctx';
import { STATUS_COLORS } from './palette';

const FONT = '600 11px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_SMALL = '600 10px "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

/** A pre-rendered label in CSS px (the canvas is dpr times larger). */
export interface Sprite {
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

function measure(text: string, font: string): number {
  const probe = measureCtx();
  probe.font = font;
  return Math.ceil(probe.measureText(text).width);
}

const measureName: Measure = (text) => measure(text, FONT);
const measureDetail: Measure = (text) => measure(text, FONT_SMALL);

const BUBBLE_MAX_W = 200;
const BUBBLE_PAD = 6;
const ICON_W = 16;
/** Room pill widths are quantised so a smooth zoom does not rebuild a sprite every frame. */
const PILL_STEP = 6;

let probeCtx: CanvasRenderingContext2D | null = null;
function measureCtx(): CanvasRenderingContext2D {
  if (!probeCtx) probeCtx = makeCanvas(4, 4).getContext('2d')!;
  return probeCtx;
}

/** Caches text sprites (name tags, bubbles, labels) per device pixel ratio. */
export class OverlaySprites {
  private cache = new Map<string, Sprite>();
  dpr = 1;

  setDpr(dpr: number): void {
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.cache.clear();
    }
  }

  /** Returns the cached sprite for `key`, or builds it from `size()` and `draw`. Measuring only happens on a miss. */
  private cached(key: string, size: () => { w: number; h: number }, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): Sprite {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const { w, h } = size();
    return this.make(key, w, h, (ctx) => draw(ctx, w, h));
  }

  private make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Sprite {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const canvas = makeCanvas(w * this.dpr, h * this.dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(this.dpr, this.dpr);
    draw(ctx);
    const sprite = { canvas, w, h };
    if (this.cache.size > 600) this.cache.clear();
    this.cache.set(key, sprite);
    return sprite;
  }

  nameTag(name: string, accent: string, status: string, kind: 'main' | 'sub', highlight: boolean): Sprite {
    const text = name.length > 16 ? `${name.slice(0, 15)}…` : name;
    return this.cached(
      `tag|${text}|${accent}|${status}|${kind}|${highlight}`,
      () => ({ w: measureName(text) + 20, h: 18 }),
      (ctx, w) => {
        const h = 16;
        ctx.fillStyle = highlight ? 'rgba(30,42,68,0.96)' : 'rgba(14,18,28,0.82)';
        roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 5);
        ctx.fill();
        ctx.strokeStyle = highlight ? 'rgba(160,190,255,0.8)' : 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = accent;
        roundRect(ctx, 4, h - 3.5, w - 8, 2, 1);
        ctx.fill();
        ctx.fillStyle = STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? status;
        ctx.beginPath();
        ctx.arc(8.5, 7.5, kind === 'sub' ? 2.2 : 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = FONT;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#eef2fa';
        ctx.fillText(text, 14.5, 8);
      },
    );
  }

  bubble(text: string, icon: string, tone: 'normal' | 'alert' | 'good'): Sprite {
    const iw = icon ? ICON_W : 0;
    return this.cached(
      `bub|${text}|${icon}|${tone}`,
      () => {
        const fit = ellipsize(text, BUBBLE_MAX_W - iw - BUBBLE_PAD * 2, measureName);
        return { w: measureName(fit) + iw + BUBBLE_PAD * 2, h: 27 };
      },
      (ctx, w) => {
        const h = 21;
        const fit = ellipsize(text, BUBBLE_MAX_W - iw - BUBBLE_PAD * 2, measureName);
        const fill = tone === 'alert' ? '#ffe9b8' : tone === 'good' ? '#dff7e8' : '#fbfcfe';
        const edge = tone === 'alert' ? '#e0a02e' : tone === 'good' ? '#4fb583' : '#9aa6bd';
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        roundRect(ctx, 1, 2, w - 1, h - 1, 7);
        ctx.fill();
        ctx.fillStyle = fill;
        ctx.strokeStyle = edge;
        ctx.lineWidth = 1.2;
        roundRect(ctx, 0.6, 0.6, w - 1.5, h - 1.5, 7);
        ctx.fill();
        ctx.stroke();
        const mid = w / 2;
        ctx.beginPath();
        ctx.moveTo(mid - 4, h - 1);
        ctx.lineTo(mid, h + 4);
        ctx.lineTo(mid + 4, h - 1);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = edge;
        ctx.beginPath();
        ctx.moveTo(mid - 4, h - 1);
        ctx.lineTo(mid, h + 4);
        ctx.lineTo(mid + 4, h - 1);
        ctx.stroke();
        ctx.fillStyle = fill;
        ctx.fillRect(mid - 3.2, h - 2, 6.4, 2);
        ctx.textBaseline = 'middle';
        if (icon) {
          ctx.font = '12px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
          ctx.fillStyle = '#222';
          ctx.fillText(icon, BUBBLE_PAD, h / 2 + 0.5);
        }
        ctx.font = FONT;
        ctx.fillStyle = '#1d2433';
        ctx.fillText(fit, BUBBLE_PAD + iw, h / 2 + 0.5);
      },
    );
  }

  /** Room pill that always fits in `maxWidth` CSS px: shortens the name, drops the detail, or shrinks to the dot. */
  roomLabel(name: string, detail: string, accent: string, maxWidth: number): Sprite {
    const limit = Math.max(0, Math.floor(maxWidth / PILL_STEP) * PILL_STEP);
    return this.cached(
      `room|${name}|${detail}|${accent}|${limit}`,
      () => ({ w: fitRoomLabel(name, detail, limit, measureName, measureDetail).width, h: 20 }),
      (ctx, w, h) => {
        const fit = fitRoomLabel(name, detail, limit, measureName, measureDetail);
        const dot = fit.name ? 10 : w / 2;
        ctx.fillStyle = 'rgba(12,16,26,0.86)';
        roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 10);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(dot, h / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (!fit.name) return;
        ctx.textBaseline = 'middle';
        ctx.font = FONT;
        ctx.fillStyle = '#eef2fa';
        ctx.fillText(fit.name, 19, h / 2 + 0.5);
        if (fit.detail) {
          ctx.font = FONT_SMALL;
          ctx.fillStyle = '#9aa6b8';
          ctx.fillText(fit.detail, 19 + measureName(fit.name) + 8, h / 2 + 0.5);
        }
      },
    );
  }

  /** Round status badge: "!" for needs-you, "z" while napping. */
  badge(symbol: string, color: string): Sprite {
    const d = 16;
    return this.make(`badge|${symbol}|${color}`, d + 2, d + 2, (ctx) => {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(d / 2 + 1, d / 2 + 2, d / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(d / 2 + 1, d / 2 + 1, d / 2 - 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#2a1a02';
      ctx.font = '800 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbol, d / 2 + 1, d / 2 + 1.5);
    });
  }
}
