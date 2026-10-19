import type { Agent } from '@ai-office/shared';
import { drawPixelText, textWidth } from '../font';
import { LED } from '../palette';
import { context2d, hline, makeCanvas, rect } from '../paint/ctx';

export interface RoomInfo {
  agents: number;
  working: number;
  waiting: number;
  tasksTotal: number;
  tasksDone: number;
  current: string | null;
}

export function summarizeRoom(agents: readonly Agent[]): RoomInfo {
  const info: RoomInfo = { agents: 0, working: 0, waiting: 0, tasksTotal: 0, tasksDone: 0, current: null };
  for (const a of agents) {
    if (a.status === 'done' || a.status === 'offline') continue;
    info.agents++;
    if (a.status === 'working') info.working++;
    if (a.status === 'waiting') info.waiting++;
    if (a.kind !== 'main') continue;
    for (const t of a.tasks) {
      info.tasksTotal++;
      if (t.status === 'completed') info.tasksDone++;
      else if (t.status === 'in_progress' && !info.current) info.current = t.activeForm ?? t.title;
    }
  }
  return info;
}

export function roomInfoKey(info: RoomInfo): string {
  return `${info.agents}|${info.working}|${info.waiting}|${info.tasksDone}/${info.tasksTotal}|${info.current ?? ''}`;
}

function fit(text: string, maxPx: number): string {
  let out = text;
  while (out.length > 1 && textWidth(out) > maxPx) out = out.slice(0, -1);
  return out === text ? out : `${out.slice(0, -1)}.`;
}

/** Wall board of a project room: task progress and the task being worked on. */
export function renderBoard(w: number, h: number, info: RoomInfo, accent: string): HTMLCanvasElement {
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  rect(ctx, 0, 0, w, h, '#0b1322');
  const head = info.tasksTotal ? `TAREFAS ${info.tasksDone}/${info.tasksTotal}` : info.agents ? 'SEM TAREFAS' : 'SALA VAZIA';
  drawPixelText(ctx, head, 2, 2, accent);
  const barW = w - 4;
  rect(ctx, 2, 8, barW, 1, '#1d2b45');
  if (info.tasksTotal) rect(ctx, 2, 8, Math.round((barW * info.tasksDone) / info.tasksTotal), 1, LED.teal);
  const line = info.current ?? (info.waiting ? 'AGUARDANDO VOCE' : info.working ? 'TRABALHANDO' : '');
  if (line) drawPixelText(ctx, fit(line, w - 4), 2, 5 + 5 > h ? 4 : 5 + 0, '#c9d6ee');
  return canvas;
}

/** Meeting-room TV: who is in the room. */
export function renderMeetingTv(w: number, h: number, names: readonly string[]): HTMLCanvasElement {
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  rect(ctx, 0, 0, w, h, '#0a1424');
  rect(ctx, 0, 0, w, 6, '#1d3a63');
  drawPixelText(ctx, names.length ? `NA SALA ${names.length}` : 'SALA LIVRE', 2, 1, '#e8f1ff');
  hline(ctx, 0, 6, w, LED.teal);
  const colW = Math.floor((w - 4) / 2);
  names.slice(0, 6).forEach((name, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    rect(ctx, 2 + col * colW, 9 + row * 4, 2, 2, i % 3 === 0 ? '#3ecf8e' : '#6ea2ff');
    drawPixelText(ctx, fit(name, colW - 6), 6 + col * colW, 8 + row * 4 - 1, '#c9d6ee');
  });
  return canvas;
}
