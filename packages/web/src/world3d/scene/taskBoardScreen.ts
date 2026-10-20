// The meeting-room whiteboard in 3D: the live task board (counts per column and the first tasks in progress),
// drawn like marker on a whiteboard. Texts are fitted to the canvas because their width depends on the language.
import { type WorldText, worldText } from '../../i18n/world/translate';
import { TASK_COLUMN_COLORS, type TaskBoardSummary } from '../../world/taskBoard';
import { fitFont } from './textFit';
import { fitText, font } from './screens';

const INK = '#27303f';
const MUTED = '#7b8392';
const PAD = 22;

export function paintTaskBoard(ctx: CanvasRenderingContext2D, w: number, h: number, summary: TaskBoardSummary, text: WorldText = worldText('pt-BR')): void {
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = font(17, 700);
  ctx.fillText(fitText(ctx, text.t('taskboard.title').toLocaleUpperCase(text.locale), w - 2 * PAD), PAD, 24);
  ctx.fillStyle = '#d3d9e0';
  ctx.fillRect(PAD, 42, w - 2 * PAD, 2);

  const columns = [
    { color: TASK_COLUMN_COLORS.pending, n: summary.pending, label: text.t('taskboard.pending') },
    { color: TASK_COLUMN_COLORS.active, n: summary.active, label: text.t('taskboard.active') },
    { color: TASK_COLUMN_COLORS.done, n: summary.done, label: text.t('taskboard.done') },
  ];
  const cell = (w - 2 * PAD) / columns.length;
  columns.forEach((column, i) => {
    const x = PAD + i * cell;
    ctx.fillStyle = column.color;
    ctx.fillRect(x, 58, cell - 14, 4);
    ctx.font = font(48, 700);
    ctx.fillText(String(column.n), x, 96);
    const label = column.label.toLocaleUpperCase(text.locale);
    ctx.font = font(fitFont(ctx, label, (size) => font(size, 600), cell - 14, 16, 11), 600);
    ctx.fillStyle = INK;
    ctx.fillText(fitText(ctx, label, cell - 14), x, 132);
  });

  ctx.fillStyle = '#d3d9e0';
  ctx.fillRect(PAD, 152, w - 2 * PAD, 2);
  if (columns.every((column) => column.n === 0)) {
    ctx.fillStyle = MUTED;
    ctx.font = font(24, 500);
    ctx.fillText(fitText(ctx, text.t('taskboard.empty'), w - 2 * PAD), PAD, 196);
    return;
  }
  ctx.font = font(22, 500);
  summary.top.forEach((title, i) => {
    const y = 176 + i * 30;
    ctx.fillStyle = TASK_COLUMN_COLORS.active;
    ctx.beginPath();
    ctx.arc(PAD + 6, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.fillText(fitText(ctx, text.tm(title.msg, title.text), w - 2 * PAD - 24), PAD + 22, y);
  });
}
