import type { Agent, Msg } from '@ai-office/shared';
import { type WorldText, worldText } from '../../i18n/world/translate';
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
  /** Localizable form of `current` (demo tasks); real task texts have none and are shown as written. */
  currentMsg?: Msg;
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
      else if (t.status === 'in_progress' && !info.current) {
        info.current = t.activeForm ?? t.title;
        info.currentMsg = t.activeForm ? t.activeFormMsg : t.titleMsg;
      }
    }
  }
  return info;
}

export function roomInfoKey(info: RoomInfo): string {
  const msg = info.currentMsg ? JSON.stringify(info.currentMsg) : '';
  return `${info.agents}|${info.working}|${info.waiting}|${info.tasksDone}/${info.tasksTotal}|${info.current ?? ''}|${msg}`;
}

/** `text` cut to `maxPx` with a final dot ("WAITING." not "WAITING ."); the text itself when it fits. */
export function fit(text: string, maxPx: number): string {
  let out = text;
  while (out.length > 1 && textWidth(out) > maxPx) out = out.slice(0, -1);
  return out === text ? out : `${out.slice(0, -1).trimEnd()}.`;
}

/** First candidate (full text, then shorter forms) that fits `maxPx`; the last one cut with a dot when none does. */
export function pickFitting(candidates: readonly string[], maxPx: number): string {
  const found = candidates.find((candidate) => textWidth(candidate) <= maxPx);
  return found ?? fit(candidates[candidates.length - 1] ?? '', maxPx);
}

/** The line a room board shows: the task in progress, else the room's state. */
export function boardLine(info: RoomInfo, text: WorldText): string {
  return boardLineForms(info, text)[0] ?? '';
}

/** The board line from the most to the least complete form; only states have short forms (task texts are as written). */
export function boardLineForms(info: RoomInfo, text: WorldText): string[] {
  if (info.current) return [text.tm(info.currentMsg, info.current)];
  if (info.waiting) return [text.t('board.waiting'), text.t('board.waiting.short')];
  if (info.working) return [text.t('board.working'), text.t('board.working.short')];
  if (info.agents) return [text.t('board.idle')];
  return [text.t('board.empty'), text.t('board.empty.short')];
}

/** Wall board of a project room: task progress and the task being worked on. */
export function renderBoard(w: number, h: number, info: RoomInfo, accent: string, text: WorldText = worldText('pt-BR')): HTMLCanvasElement {
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  rect(ctx, 0, 0, w, h, '#0b1322');
  const progress = info.tasksTotal ? `${info.tasksDone}/${info.tasksTotal} ` : '';
  const forms = boardLineForms(info, text);
  drawPixelText(ctx, progress, 3, 1, accent);
  const offset = textWidth(progress);
  drawPixelText(ctx, pickFitting(forms, w - 5 - offset), 3 + offset, 1, '#c9d6ee');
  if (info.tasksTotal) {
    rect(ctx, 3, h - 1, w - 6, 1, '#1d2b45');
    rect(ctx, 3, h - 1, Math.round(((w - 6) * info.tasksDone) / info.tasksTotal), 1, LED.teal);
  }
  return canvas;
}

/** Meeting-room TV: who is in the room. */
export function renderMeetingTv(w: number, h: number, names: readonly string[], text: WorldText = worldText('pt-BR')): HTMLCanvasElement {
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  rect(ctx, 0, 0, w, h, '#0a1424');
  rect(ctx, 0, 0, w, 7, '#1d3a63');
  drawPixelText(ctx, names.length ? text.t('meeting.inRoom', { n: names.length }) : text.t('meeting.free'), 3, 1, '#e8f1ff');
  hline(ctx, 0, 7, w, LED.teal);
  const cols = 3;
  const colW = Math.floor((w - 4) / cols);
  names.slice(0, cols * 2).forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 3 + col * colW;
    const y = 10 + row * 6;
    rect(ctx, x, y + 1, 2, 3, i % 3 === 0 ? '#3ecf8e' : '#6ea2ff');
    drawPixelText(ctx, fit(name, colW - 7), x + 4, y, '#c9d6ee');
  });
  return canvas;
}
