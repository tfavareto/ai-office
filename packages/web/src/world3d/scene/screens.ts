// Canvas-driven screens: the workstation monitor atlas, room boards, TVs, menu board and the corridor LED ticker.
import { CanvasTexture, MeshBasicMaterial, RepeatWrapping, SRGBColorSpace } from 'three';
import type { AgentStatus, Msg } from '@ai-office/shared';
import { type WorldText, worldText } from '../../i18n/world/translate';
import { Rng } from '../../layout/rng';
import type { RoomGit } from '../../world/roomGit';
import { boardLine } from '../../world2d/runtime/boards';
import { menuLayout } from './menuLayout';
import { fitFont } from './textFit';
import { canvas2d } from './textures';

export const FONT = '600 {s}px "Inter", "SF Pro Text", system-ui, sans-serif';
export const font = (size: number, weight = 600): string =>
  `${weight} ${size}px "Inter", "SF Pro Text", system-ui, sans-serif`;

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxPx: number): string {
  if (ctx.measureText(text).width <= maxPx) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxPx) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

function screenMaterial(tex: CanvasTexture): MeshBasicMaterial {
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return new MeshBasicMaterial({ map: tex, toneMapped: false });
}

// ------------------------------------------------------------------------------------------------------------------
// workstation atlas

const CELL_W = 160;
const CELL_H = 96;
const K = CELL_W / 256;
const COLS = 4;
const ROWS = 6;
const ATLAS_W = CELL_W * COLS;
const ATLAS_H = CELL_H * ROWS;
const STRIP_H = 400;

export interface DeskState {
  status: AgentStatus | 'empty';
  seed: number;
}

/** Pre-rendered tall "content strips" that scroll inside the monitor cells. */
function makeStrips(): HTMLCanvasElement[] {
  const rng = new Rng(4242);
  const strips: HTMLCanvasElement[] = [];
  for (let kind = 0; kind < COLS; kind++) {
    const { canvas, ctx } = canvas2d(CELL_W, STRIP_H);
    const bg = ['#0c1118', '#141a24', '#e9edf2', '#0e1620'][kind];
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CELL_W, STRIP_H);
    const palette = [
      ['#6fe0a0', '#3fb27a', '#9ad8ff'],
      ['#e0795a', '#ffd479', '#8fb7ff', '#b7e48a'],
      ['#c3cad6', '#aab4c4', '#2f6fed'],
      ['#58d68d', '#ff6b6b', '#8fb7ff'],
    ][kind];
    let y = 8;
    while (y < STRIP_H - 10) {
      if (kind === 2) {
        const h = (rng.int(3) === 0 ? 34 : 7) * K;
        ctx.fillStyle = h > 10 * K ? '#cfd6e2' : palette[rng.int(palette.length)];
        ctx.fillRect(
          (14 + (h > 10 * K ? 0 : rng.int(10))) * K,
          y,
          (h > 10 * K ? 80 + rng.int(120) : 120 + rng.int(100)) * K,
          h,
        );
        y += h + 8 * K;
        continue;
      }
      const indent = rng.int(4) * 10 * K;
      let x = 10 * K + indent;
      const end = (60 + rng.int(180)) * K;
      while (x < end) {
        const w = (12 + rng.int(46)) * K;
        ctx.fillStyle = palette[rng.int(palette.length)];
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y, w, Math.max(2, 5 * K));
        ctx.globalAlpha = 1;
        x += w + 5 * K;
      }
      y += 11 * K;
    }
    strips.push(canvas);
  }
  return strips;
}

/** One texture holding every monitor of a room (24 cells); drawn at a low rate and uploaded as a single texture. */
export class WorkstationAtlas {
  readonly texture: CanvasTexture;
  readonly material: MeshBasicMaterial;
  private readonly ctx: CanvasRenderingContext2D;
  private static strips: HTMLCanvasElement[] | null = null;
  /** Text of the amber badge on the first monitor of a waiting agent, upper case. */
  private waitingLabel = '! AGUARDA';

  constructor() {
    const { canvas, ctx } = canvas2d(ATLAS_W, ATLAS_H);
    this.ctx = ctx;
    this.texture = new CanvasTexture(canvas);
    this.material = screenMaterial(this.texture);
    WorkstationAtlas.strips ??= makeStrips();
    for (let d = 0; d < ROWS; d++)
      for (let s = 0; s < COLS; s++) this.drawCell(d, s, { status: 'empty', seed: 0 }, 0, 1);
    this.texture.needsUpdate = true;
  }

  /** Language of the badge; the cells repaint at the next `update`. */
  setText(text: WorldText): void {
    this.waitingLabel = `! ${text.t('desk.waiting').toLocaleUpperCase(text.locale)}`;
  }

  /** UV rectangle of a cell: [u0, v0, u1, v1] (canvas row 0 is at the top; textures here are not flipped). */
  static uv(desk: number, slot: number): [number, number, number, number] {
    const inset = 0.004;
    return [
      (slot * CELL_W) / ATLAS_W + inset,
      (desk * CELL_H) / ATLAS_H + inset,
      ((slot + 1) * CELL_W) / ATLAS_W - inset,
      ((desk + 1) * CELL_H) / ATLAS_H - inset,
    ];
  }

  update(time: number, desks: readonly DeskState[], brightness: number): void {
    for (let d = 0; d < ROWS; d++) {
      const state = desks[d] ?? { status: 'empty' as const, seed: 0 };
      for (let s = 0; s < COLS; s++) this.drawCell(d, s, state, time, brightness);
    }
    this.texture.needsUpdate = true;
  }

  private drawCell(desk: number, slot: number, state: DeskState, time: number, brightness: number): void {
    const { ctx } = this;
    const x = slot * CELL_W;
    const y = desk * CELL_H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL_W, CELL_H);
    ctx.clip();
    const strips = WorkstationAtlas.strips!;
    if (state.status === 'empty') {
      const g = ctx.createLinearGradient(x, y, x + CELL_W, y + CELL_H);
      g.addColorStop(0, '#1b2b4a');
      g.addColorStop(1, '#0d1626');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, CELL_W, CELL_H);
    } else if (state.status === 'idle') {
      ctx.fillStyle = '#10151d';
      ctx.fillRect(x, y, CELL_W, CELL_H);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(strips[slot], 0, 25 + (state.seed % 120), CELL_W, CELL_H, x, y, CELL_W, CELL_H);
      ctx.globalAlpha = 1;
    } else {
      const speed = state.status === 'working' ? 22 : 4;
      const scroll = (time * speed + state.seed * 13 + slot * 97) % (STRIP_H - CELL_H);
      ctx.drawImage(strips[slot], 0, scroll, CELL_W, CELL_H, x, y, CELL_W, CELL_H);
      if (state.status === 'waiting' && slot === 0) {
        const pulse = 0.55 + 0.45 * Math.sin(time * 5);
        ctx.fillStyle = `rgba(255,190,60,${pulse})`;
        ctx.fillRect(x + 12, y + 30, CELL_W - 24, 38);
        ctx.fillStyle = '#2a1a00';
        ctx.font = font(
          fitFont(ctx, this.waitingLabel, (size) => font(size, 800), CELL_W - 40, 21, 12),
          800,
        );
        ctx.textAlign = 'center';
        ctx.fillText(this.waitingLabel, x + CELL_W / 2, y + 57);
      }
    }
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0, 1 - brightness)})`;
    ctx.fillRect(x, y, CELL_W, CELL_H);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

// ------------------------------------------------------------------------------------------------------------------
// TVs and boards (each its own small canvas, redrawn only when the content changes)

export class CanvasScreen {
  readonly texture: CanvasTexture;
  readonly material: MeshBasicMaterial;
  readonly ctx: CanvasRenderingContext2D;
  private key = '';

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const { canvas, ctx } = canvas2d(width, height);
    this.ctx = ctx;
    this.texture = new CanvasTexture(canvas);
    this.material = screenMaterial(this.texture);
  }

  /** Redraws when `key` changed. */
  draw(key: string, painter: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    if (key === this.key) return;
    this.key = key;
    painter(this.ctx, this.width, this.height);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

export interface BoardInfo {
  agents: number;
  working: number;
  waiting: number;
  tasksTotal: number;
  tasksDone: number;
  current: string | null;
  currentMsg?: Msg;
  /** The room's repository, for the plaque under the sign. */
  git?: RoomGit | undefined;
}

export function paintBoard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  name: string,
  info: BoardInfo,
  accent: string,
  text: WorldText = worldText('pt-BR'),
): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d1830');
  g.addColorStop(1, '#070d1c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 10, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8f1ff';
  const agents = text.t('count.agents', { n: info.agents });
  ctx.font = font(22, 500);
  const agentsW = ctx.measureText(agents).width;
  ctx.fillStyle = '#9fb0cc';
  ctx.textAlign = 'right';
  ctx.fillText(agents, w - 24, 38);
  ctx.fillStyle = '#e8f1ff';
  ctx.font = font(34, 700);
  ctx.textAlign = 'left';
  ctx.fillText(fitText(ctx, name.toUpperCase(), w - 34 - 24 - agentsW - 24), 34, 38);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(34, 68, w - 58, 2);
  const line = boardLine(info, text);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6fe0c8';
  ctx.font = font(20, 600);
  ctx.fillText(text.t('board.inProgress').toLocaleUpperCase(text.locale), 34, 104);
  ctx.fillStyle = '#e8f1ff';
  ctx.font = font(30, 600);
  ctx.fillText(fitText(ctx, line, w - 70), 34, 144);
  const total = Math.max(1, info.tasksTotal);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(34, h - 62, w - 68, 14);
  ctx.fillStyle = accent;
  ctx.fillRect(34, h - 62, ((w - 68) * info.tasksDone) / total, 14);
  ctx.fillStyle = '#9fb0cc';
  ctx.font = font(20, 500);
  const tasks = info.tasksTotal
    ? text.t('board.tasks', { done: info.tasksDone, total: info.tasksTotal })
    : text.t('board.noTasks');
  ctx.fillText(tasks, 34, h - 28);
  if (info.waiting) {
    const tasksW = ctx.measureText(tasks).width;
    ctx.fillStyle = '#ffbe3c';
    ctx.textAlign = 'right';
    ctx.fillText(
      fitText(ctx, text.t('count.needsYou', { n: info.waiting }), w - 34 - 24 - tasksW - 24),
      w - 24,
      h - 28,
    );
  }
}

export function paintMeetingTv(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  names: readonly string[],
  text: WorldText = worldText('pt-BR'),
): void {
  ctx.fillStyle = '#0a1424';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1d3a63';
  ctx.fillRect(0, 0, w, 64);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8f1ff';
  ctx.font = font(34, 700);
  const title = (
    names.length ? text.t('meeting.inRoom3d', { n: names.length }) : text.t('meeting.free')
  ).toLocaleUpperCase(text.locale);
  ctx.fillText(fitText(ctx, title, w - 56), 28, 33);
  ctx.fillStyle = '#38b6c2';
  ctx.fillRect(0, 64, w, 4);
  ctx.font = font(30, 500);
  names.slice(0, 12).forEach((name, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 28 + col * ((w - 40) / 3);
    const y = 110 + row * 52;
    ctx.fillStyle = i % 3 === 0 ? '#3ecf8e' : '#6ea2ff';
    ctx.beginPath();
    ctx.arc(x + 8, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d6e2f5';
    ctx.fillText(fitText(ctx, name, (w - 40) / 3 - 40), x + 26, y);
  });
}

export function paintMenu(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: WorldText = worldText('pt-BR'),
): void {
  const items: [Parameters<WorldText['t']>[0], number][] = [
    ['menu3d.espresso', 4],
    ['menu3d.cappuccino', 8],
    ['menu3d.cheeseBread', 6],
    ['menu3d.orangeJuice', 7],
    ['menu3d.sparkling', 3],
  ];
  const layout = menuLayout(w, h, items.length);
  ctx.fillStyle = '#22262b';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c9a456';
  ctx.lineWidth = Math.max(3, Math.round(h * 0.0235));
  const inset = Math.round(h * 0.039);
  ctx.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);
  ctx.fillStyle = '#f2ead8';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const title = text.t('menu3d.title').toLocaleUpperCase(text.locale);
  const titleMax = w - 2 * layout.left;
  ctx.font = font(
    fitFont(ctx, title, (size) => font(size, 700), titleMax, layout.titleSize, Math.round(layout.titleSize * 0.6)),
    700,
  );
  ctx.fillText(fitText(ctx, title, titleMax), w / 2, layout.titleY);
  ctx.fillStyle = 'rgba(201,164,86,0.55)';
  ctx.fillRect(layout.left, layout.titleRuleY, layout.right - layout.left, 1.5);
  items.forEach(([key, price], i) => {
    const y = layout.rowY[i];
    const cost = text.t('menu3d.price', { price });
    const name = text.t(key);
    ctx.font = font(layout.rowSize, 500);
    ctx.textAlign = 'right';
    const costW = ctx.measureText(cost).width;
    ctx.fillStyle = '#e0b86a';
    ctx.fillText(cost, layout.right, y);
    const nameMax = layout.right - layout.left - costW - layout.rowSize;
    ctx.font = font(
      fitFont(ctx, name, (size) => font(size, 500), nameMax, layout.rowSize, layout.rowMinSize),
      500,
    );
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2ead8';
    ctx.fillText(fitText(ctx, name, nameMax), layout.left, y);
    const ruleY = layout.ruleY[i];
    if (ruleY === undefined) return;
    ctx.fillStyle = 'rgba(242,234,216,0.2)';
    ctx.fillRect(layout.left, ruleY, layout.right - layout.left, 1.5);
  });
}

export function paintLoungeTv(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const g = ctx.createLinearGradient(0, 0, w, h);
  const hue = (t * 12) % 360;
  g.addColorStop(0, `hsl(${hue},60%,30%)`);
  g.addColorStop(1, `hsl(${(hue + 80) % 360},60%,16%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = font(60, 300);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const d = new Date();
  ctx.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, w / 2, h / 2);
}

/** Style of a project room's sign: the brass plate (0) every room had, a neon tube (1), engraved wood (2) or a plain plate (3). */
function paintStyledSign(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  accent: string,
  style: number,
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(Math.round(h * 0.5), 700);
  const label = fitText(ctx, text, w - 40);
  if (style === 1) {
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, w / 2, h / 2 + 2);
    ctx.shadowBlur = 0;
    return;
  }
  if (style === 2) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#7c5232');
    grad.addColorStop(1, '#5a3a22');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(30,16,8,0.25)';
    for (let y = h / 4; y < h; y += h / 4) ctx.fillRect(0, y, w, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillText(label, w / 2 + 2, h / 2 + 3);
    ctx.fillStyle = '#f3dfb8';
    ctx.fillText(label, w / 2, h / 2 + 1);
    return;
  }
  ctx.fillStyle = '#efece4';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, h - 10, w, 10);
  ctx.fillRect(14, h / 2 - 22, 12, 36);
  ctx.fillStyle = '#22262e';
  ctx.fillText(label, w / 2 + 12, h / 2 - 4);
}

export function paintSign(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  text: string,
  accent: string,
  dark: boolean,
  style = 0,
): void {
  if (style > 0) return paintStyledSign(ctx, w, h, text, accent, style);
  ctx.fillStyle = dark ? '#14161a' : '#d9c28a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(0, h - 10, w, 10);
  ctx.fillStyle = dark ? '#f2ead8' : '#2a1c0e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(Math.round(h * 0.5), 700);
  ctx.fillText(fitText(ctx, text, w - 40), w / 2, h / 2 - 4);
}

export function paintPoster(ctx: CanvasRenderingContext2D, w: number, h: number, variant: number): void {
  const rng = new Rng(300 + variant);
  const bg = ['#e9dfcf', '#d5e0e8', '#ead3cc'][variant % 3];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = `hsla(${rng.int(360)},55%,${40 + rng.int(25)}%,0.85)`;
    ctx.beginPath();
    if (i % 2) ctx.arc(rng.range(0.2, 0.8) * w, rng.range(0.2, 0.8) * h, rng.range(0.1, 0.3) * w, 0, Math.PI * 2);
    else ctx.rect(rng.range(0.05, 0.5) * w, rng.range(0.05, 0.6) * h, rng.range(0.2, 0.5) * w, rng.range(0.1, 0.3) * h);
    ctx.fill();
  }
}

/** Scrolling LED marquee along the corridor: a long strip texture with one text period, scrolled via UV offset. */
const TICKER_W = 4096;
const TICKER_PAD = 12;
const TICKER_FONT = 44;
const TICKER_MIN_FONT = 28;
/** The text must leave a gap before the strip repeats, in every language. */
const TICKER_MAX_TEXT_PX = TICKER_W - TICKER_PAD - 220;

export class TickerStrip {
  readonly texture: CanvasTexture;
  readonly material: MeshBasicMaterial;
  periodMeters = 23;
  private text = '';

  constructor() {
    const { canvas } = canvas2d(TICKER_W, 64);
    this.texture = new CanvasTexture(canvas);
    this.texture.wrapS = RepeatWrapping;
    this.material = screenMaterial(this.texture);
    this.material.transparent = true;
  }

  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    const canvas = this.texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(14,9,6,0.62)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffb347';
    const msg = text.toUpperCase();
    ctx.font = font(
      fitFont(ctx, msg, (size) => font(size, 700), TICKER_MAX_TEXT_PX, TICKER_FONT, TICKER_MIN_FONT),
      700,
    );
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(msg, TICKER_PAD, 34);
    this.texture.needsUpdate = true;
  }

  scroll(time: number, lengthMeters: number): void {
    const periodsAcross = lengthMeters / this.periodMeters;
    this.texture.repeat.x = periodsAcross;
    this.texture.offset.x = -(time * 0.04) % 1;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}

// ------------------------------------------------------------------------------------------------------------------
// static decor atlas: signs, posters, menu and whiteboard of an area share one texture (one draw call)

const DECOR_SIZE = 1024;
export const DECOR_PX_PER_M = 256;

export interface DecorSlot {
  /** UV rectangle [u0, vTop0, u1, vTop1] (canvas rows from the top). */
  uv: [number, number, number, number];
}

export type DecorPainter = (ctx: CanvasRenderingContext2D, w: number, h: number, text: WorldText) => void;

interface PlacedDecor {
  x: number;
  y: number;
  w: number;
  h: number;
  painter: DecorPainter;
  /** Paints words of the viewer's language, so it is redrawn when the language changes. */
  localized: boolean;
}

export class DecorAtlas {
  readonly texture: CanvasTexture;
  readonly material: MeshBasicMaterial;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly placed: PlacedDecor[] = [];
  private text: WorldText;
  private x = 0;
  private y = 0;
  private rowH = 0;

  constructor(text: WorldText = worldText('pt-BR')) {
    this.text = text;
    const { canvas, ctx } = canvas2d(DECOR_SIZE, DECOR_SIZE);
    this.ctx = ctx;
    this.texture = new CanvasTexture(canvas);
    this.material = screenMaterial(this.texture);
  }

  /** Reserves a w x h metre region, paints it and returns its UVs. */
  add(wMeters: number, hMeters: number, painter: DecorPainter, localized = false): DecorSlot {
    const w = Math.round(wMeters * DECOR_PX_PER_M);
    const h = Math.round(hMeters * DECOR_PX_PER_M);
    if (this.x + w > DECOR_SIZE) {
      this.x = 0;
      this.y += this.rowH + 2;
      this.rowH = 0;
    }
    const x = this.x;
    const y = this.y;
    this.x += w + 2;
    this.rowH = Math.max(this.rowH, h);
    const item: PlacedDecor = { x, y, w, h, painter, localized };
    this.placed.push(item);
    this.paint(item);
    this.texture.needsUpdate = true;
    return { uv: [x / DECOR_SIZE, y / DECOR_SIZE, (x + w) / DECOR_SIZE, (y + h) / DECOR_SIZE] };
  }

  /** Switches the language: repaints the regions that hold words and uploads the texture once. */
  setText(text: WorldText): void {
    if (text.locale === this.text.locale) return;
    this.text = text;
    let changed = false;
    for (const item of this.placed) {
      if (!item.localized) continue;
      this.paint(item);
      changed = true;
    }
    if (changed) this.texture.needsUpdate = true;
  }

  private paint(item: PlacedDecor): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(item.x, item.y, item.w, item.h);
    ctx.clip();
    ctx.clearRect(item.x, item.y, item.w, item.h);
    ctx.translate(item.x, item.y);
    item.painter(ctx, item.w, item.h, this.text);
    ctx.restore();
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
