// Pure geometry of a workstation's monitor pair, shared by the desk painter (frames, stands) and the renderer (live screens).
import { SCREEN_H, SCREEN_W } from '../runtime/screens';

/** Number of monitors on every workstation. */
export const DESK_MONITORS = 2;
/** Width of a desk sprite in px (4 tiles): the seat sits on its centre line. */
export const DESK_W = 64;
/** Pixels between the two monitor frames. */
export const MONITOR_GAP = 2;
/** Bezel around a screen: 1px on the sides and top, a 2px chin below. */
export const BEZEL = 1;
export const CHIN = 2;
export const FRAME_W = SCREEN_W + BEZEL * 2;
export const FRAME_H = SCREEN_H + BEZEL + CHIN;
/** Top of the monitor frames, relative to the desk footprint's top edge (negative: they rise above the desk). */
export const FRAME_TOP = -(FRAME_H - 1);

export interface MonitorRect {
  /** Top-left of the live screen area, relative to the desk footprint's top-left. */
  x: number;
  y: number;
  /** Top-left of the monitor frame around it. */
  frameX: number;
  frameY: number;
}

/** The monitor pair, centred on the desk's centre line (where the chair and the seated person are). */
export function deskScreenRects(deskWidth: number = DESK_W): MonitorRect[] {
  const total = FRAME_W * DESK_MONITORS + MONITOR_GAP * (DESK_MONITORS - 1);
  const left = Math.floor((deskWidth - total) / 2);
  return Array.from({ length: DESK_MONITORS }, (_, i) => {
    const frameX = left + i * (FRAME_W + MONITOR_GAP);
    return { x: frameX + BEZEL, y: FRAME_TOP + BEZEL, frameX, frameY: FRAME_TOP };
  });
}
