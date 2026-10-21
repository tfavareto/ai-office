// The branch plaque under a project room's sign (3D): the branch (fitted to the plate), a marker for uncommitted work
// or an operation in progress with its word in the viewer's language, commits ahead/behind and the CI light.
import { type WorldText } from '../../i18n/world/translate';
import { CI_COLORS, PLAQUE_COLORS, fitBranch, plaqueTone, type RoomGit } from '../../world/roomGit';
import { fitText, font } from './screens';
import { fitFont } from './textFit';

export const PLAQUE_CANVAS_W = 480;
export const PLAQUE_CANVAS_H = 80;
/** Size of the plaque in metres. */
export const PLAQUE_WIDTH_M = 1.8;
export const PLAQUE_HEIGHT_M = 1.8 * (PLAQUE_CANVAS_H / PLAQUE_CANVAS_W);

const PAD = 18;
const MARKER_W = 10;
const LIGHT_R = 15;
const BRANCH_FONT = 38;
const BRANCH_MIN_FONT = 24;
const NOTE_FONT = 26;
const MAX_BRANCH_CHARS = 36;

/** The small right-hand note: the operation in progress, else the commits ahead and behind. */
export function plaqueNote(info: RoomGit, text: WorldText): string {
  if (info.op !== null) return text.t(`git.op.${info.op}`).toLocaleUpperCase(text.locale);
  const parts: string[] = [];
  if (info.ahead > 0) parts.push(`↑${info.ahead}`);
  if (info.behind > 0) parts.push(`↓${info.behind}`);
  return parts.join(' ');
}

export function paintPlaque(ctx: CanvasRenderingContext2D, w: number, h: number, info: RoomGit, text: WorldText): void {
  ctx.fillStyle = '#14161a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#b8923f';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
  const tone = plaqueTone(info);
  ctx.fillStyle = PLAQUE_COLORS[tone];
  ctx.fillRect(PAD, 18, MARKER_W, h - 36);

  const lightSpace = info.ci === 'none' ? 0 : LIGHT_R * 2 + PAD;
  let right = w - PAD - lightSpace;
  ctx.textBaseline = 'middle';
  const note = plaqueNote(info, text);
  if (note !== '') {
    ctx.font = font(NOTE_FONT, 700);
    ctx.textAlign = 'right';
    ctx.fillStyle = tone === 'alert' ? PLAQUE_COLORS.alert : '#9aa6b8';
    ctx.fillText(note, right, h / 2 + 1);
    right -= ctx.measureText(note).width + PAD;
  }
  const left = PAD + MARKER_W + 14;
  const label = fitBranch(info.ref, MAX_BRANCH_CHARS, '…');
  const size = fitFont(ctx, label, (s) => font(s, 700), right - left, BRANCH_FONT, BRANCH_MIN_FONT);
  ctx.font = font(size, 700);
  ctx.textAlign = 'left';
  ctx.fillStyle = info.detached ? '#a4acba' : '#f2ead8';
  ctx.fillText(fitText(ctx, label, right - left), left, h / 2 + 1);

  if (info.ci !== 'none') {
    const cx = w - PAD - LIGHT_R;
    const color = CI_COLORS[info.ci];
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, h / 2, LIGHT_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
