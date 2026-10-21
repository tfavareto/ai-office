import type { ActivityKind, AgentStatus } from '@ai-office/shared';
import { noise2 } from '../color';
import { type Ctx, context2d, hline, makeCanvas, pixel, rect } from '../paint/ctx';

export type ScreenKind = 'off' | 'standby' | 'code' | 'term' | 'read' | 'web' | 'think' | 'wait' | 'idle';

export const SCREEN_W = 14;
export const SCREEN_H = 8;
export const SCREEN_FRAMES = 6;

const sprites = new Map<string, HTMLCanvasElement>();
const SYNTAX = ['#7aa2ff', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff'];

function lines(ctx: Ctx, frame: number, seed: number, palette: readonly string[], bg: string): void {
  rect(ctx, 0, 0, SCREEN_W, SCREEN_H, bg);
  for (let i = 0; i < 3; i++) {
    const row = 1 + i * 2;
    const n = noise2(i + frame * 3, seed, 5);
    const indent = Math.floor(noise2(i + frame, seed, 6) * 3);
    const len = 3 + Math.floor(n * (SCREEN_W - 6 - indent));
    hline(ctx, 1 + indent, row, len, palette[Math.floor(noise2(i, frame + seed, 7) * palette.length)]);
    if (n > 0.55 && len < SCREEN_W - 7) hline(ctx, 2 + indent + len, row, 2, palette[(i + frame) % palette.length]);
  }
  if (frame % 2 === 0) pixel(ctx, 1 + (frame % 4), SCREEN_H - 1, '#e8eef9');
}

function drawScreen(kind: ScreenKind, frame: number): HTMLCanvasElement {
  const canvas = makeCanvas(SCREEN_W, SCREEN_H);
  const ctx = context2d(canvas);
  const mid = Math.floor(SCREEN_W / 2);
  switch (kind) {
    case 'off':
      rect(ctx, 0, 0, SCREEN_W, SCREEN_H, '#1a2030');
      hline(ctx, 0, 0, SCREEN_W, '#2a3248');
      break;
    case 'standby':
      rect(ctx, 0, 0, SCREEN_W, SCREEN_H, '#161d2c');
      hline(ctx, 0, 0, SCREEN_W, '#26304a');
      pixel(ctx, SCREEN_W - 2, SCREEN_H - 1, frame % 3 === 0 ? '#2a7a80' : '#143f44');
      break;
    case 'code':
      lines(ctx, frame, 1, SYNTAX, '#0f1626');
      break;
    case 'term':
      lines(ctx, frame, 2, ['#5af0b0', '#8fe8c8', '#3fc89a'], '#07110f');
      pixel(ctx, 1, SCREEN_H - 1, '#5af0b0');
      break;
    case 'read':
      rect(ctx, 0, 0, SCREEN_W, SCREEN_H, '#dfe7f1');
      for (let i = 0; i < 3; i++)
        hline(ctx, 1, 2 + i * 2, 5 + Math.floor(noise2(i, frame, 3) * (SCREEN_W - 7)), '#6c7a90');
      rect(ctx, 0, 0, SCREEN_W, 1, '#3b5b9a');
      break;
    case 'web':
      rect(ctx, 0, 0, SCREEN_W, SCREEN_H, '#e9eef6');
      rect(ctx, 0, 0, SCREEN_W, 2, '#2f6fed');
      rect(ctx, 1, 3, 6, 4, '#9fb6dc');
      rect(ctx, 8, 3, SCREEN_W - 9, 1, '#6c7a90');
      rect(ctx, 8, 5, SCREEN_W - 10, 1, '#6c7a90');
      if (frame % 3 === 0) pixel(ctx, SCREEN_W - 2, 0, '#ffffff');
      break;
    case 'think':
      rect(ctx, 0, 0, SCREEN_W, SCREEN_H, '#171030');
      for (let i = 0; i < 3; i++) rect(ctx, mid - 4 + i * 3, 3, 2, 2, (frame + i) % 3 === 0 ? '#bb9af7' : '#4a3a7a');
      break;
    case 'wait':
      rect(ctx, 0, 0, SCREEN_W, SCREEN_H, frame % 2 === 0 ? '#f5b544' : '#7a5316');
      rect(ctx, mid - 1, 1, 2, 4, frame % 2 === 0 ? '#3a2406' : '#f5b544');
      rect(ctx, mid - 1, 6, 2, 1, frame % 2 === 0 ? '#3a2406' : '#f5b544');
      break;
    case 'idle':
      rect(ctx, 0, 0, SCREEN_W, SCREEN_H, '#23406b');
      rect(ctx, 0, 4, SCREEN_W, 4, '#2f5a8f');
      rect(ctx, 0, 0, SCREEN_W, 1, '#1a2f50');
      pixel(ctx, 2, 2, '#e8eef9');
      pixel(ctx, 4, 2, '#e8eef9');
      pixel(ctx, SCREEN_W - 4, 5, '#7aa2ff');
      break;
  }
  return canvas;
}

export function screenSprite(kind: ScreenKind, frame: number): HTMLCanvasElement {
  const f = kind === 'wait' || kind === 'standby' ? frame % 2 : frame % SCREEN_FRAMES;
  const key = `${kind}${f}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    sprite = drawScreen(kind, f);
    sprites.set(key, sprite);
  }
  return sprite;
}

const PRIMARY: Record<ActivityKind, ScreenKind> = {
  edit: 'code',
  write: 'code',
  bash: 'term',
  read: 'read',
  search: 'read',
  web: 'web',
  think: 'think',
  prompt: 'think',
  reply: 'think',
  task: 'code',
  subagent: 'code',
  mcp: 'code',
  question: 'wait',
  permission: 'wait',
  message: 'web',
  error: 'term',
  done: 'idle',
  other: 'code',
};

/** Content of the two monitors of a desk (left, right), from what its occupant is doing. */
export function desksScreens(
  status: AgentStatus | null,
  activity: ActivityKind | undefined,
  shell: boolean,
): [ScreenKind, ScreenKind] {
  if (status === null) return ['off', 'off'];
  if (status === 'waiting') return ['code', 'wait'];
  if (status === 'working') {
    const primary: ScreenKind = shell ? 'term' : PRIMARY[activity ?? 'other'];
    return ['code', primary === 'code' ? 'term' : primary];
  }
  if (status === 'idle') return ['idle', 'standby'];
  return ['standby', 'off'];
}
