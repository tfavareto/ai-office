// Pure screen-space label layout: text fitting and collision-free placement of room pills, name tags, badges and
// speech bubbles. No canvas or DOM here, so everything is unit-testable (text width comes in as a function).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pos {
  x: number;
  y: number;
}

export type Measure = (text: string) => number;

const ELLIPSIS = '…';

/** Longest prefix of `text` (plus an ellipsis) that fits in `maxWidth`; the text itself when it already fits, '' if even one letter does not. */
export function ellipsize(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid).trimEnd() + ELLIPSIS) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const head = text.slice(0, lo).trimEnd();
  return head ? head + ELLIPSIS : '';
}

export interface RoomLabelFit {
  /** Name shown (possibly shortened with an ellipsis); '' means the pill is only the colour dot. */
  name: string;
  /** Detail shown after the name ('' when dropped for lack of room). */
  detail: string;
  /** Total pill width in CSS px. */
  width: number;
}

export interface RoomLabelMetrics {
  /** Pill width without any text (dot + paddings). */
  chrome: number;
  /** Gap between the name and the detail. */
  gap: number;
  /** Width of the pill that only holds the dot. */
  dotOnly: number;
}

export const ROOM_LABEL_METRICS: RoomLabelMetrics = { chrome: 22, gap: 8, dotOnly: 20 };

/**
 * Fit a room pill into `maxWidth`: full text first, then the name alone, then a shortened name, then just the dot.
 * `measureName` and `measureDetail` use the respective fonts.
 */
export function fitRoomLabel(
  name: string,
  detail: string,
  maxWidth: number,
  measureName: Measure,
  measureDetail: Measure,
  m: RoomLabelMetrics = ROOM_LABEL_METRICS,
): RoomLabelFit {
  const nameW = measureName(name);
  const full = m.chrome + nameW + (detail ? m.gap + measureDetail(detail) : 0);
  if (full <= maxWidth) return { name, detail, width: full };
  if (m.chrome + nameW <= maxWidth) return { name, detail: '', width: m.chrome + nameW };
  const short = ellipsize(name, maxWidth - m.chrome, measureName);
  if (short.length > 1) return { name: short, detail: '', width: m.chrome + measureName(short) };
  return { name: '', detail: '', width: m.dotOnly };
}

// ---------------------------------------------------------------------------------------------------------------
// collision-free placement

export interface LabelItem {
  id: string;
  /** Higher wins a contested spot. */
  priority: number;
  w: number;
  h: number;
  /** Top-left candidates in order of preference; a function gets the placed box of `anchorId` (if any). */
  spots: readonly Pos[] | ((anchor: Box | undefined) => readonly Pos[]);
  /** Item whose placed box the spots depend on (a bubble above its name tag). Must have the higher priority. */
  anchorId?: string;
  /** Never dropped: takes the candidate with the least overlap when none is free. */
  required?: boolean;
  /** Items of the same group are capped by `groupLimit` (bubbles per room). Required items are exempt. */
  group?: string;
}

export interface PlaceOptions {
  /** Fixed boxes that labels must avoid (room pills). */
  obstacles: readonly Box[];
  /** Labels are shifted to stay inside this box (the screen). */
  clip: Box;
  /** Minimum clear distance between two labels. */
  gap: number;
  /** Max non-required items per group. */
  groupLimit: number;
  /** Ids shown last frame: they get `keepBonus` priority so the picture does not flicker. */
  kept?: ReadonlySet<string>;
  keepBonus?: number;
}

export interface Placement {
  x: number;
  y: number;
  /** True when a required item had to overlap something. */
  overlaps: boolean;
}

function clampInto(p: Pos, w: number, h: number, clip: Box): Pos {
  return {
    x: Math.max(clip.x, Math.min(clip.x + clip.w - w, p.x)),
    y: Math.max(clip.y, Math.min(clip.y + clip.h - h, p.y)),
  };
}

/** Overlap area of `a` grown by `gap` on every side with `b` (0 when they keep the gap). */
function overlapArea(a: Box, b: Box, gap: number): number {
  const ox = Math.min(a.x + a.w + gap, b.x + b.w) - Math.max(a.x - gap, b.x);
  const oy = Math.min(a.y + a.h + gap, b.y + b.h) - Math.max(a.y - gap, b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function totalOverlap(box: Box, others: readonly Box[], gap: number): number {
  let sum = 0;
  for (const o of others) sum += overlapArea(box, o, gap);
  return sum;
}

/**
 * Greedy placement by priority. Each item takes its first candidate that is clear of the obstacles and of the items
 * placed before it; optional items without a free candidate are dropped, required ones overlap as little as possible.
 */
export function placeLabels(items: readonly LabelItem[], opts: PlaceOptions): Map<string, Placement> {
  const bonus = opts.keepBonus ?? 0;
  const score = (i: LabelItem): number => i.priority + (opts.kept?.has(i.id) ? bonus : 0);
  const order = [...items].sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed = new Map<string, Placement>();
  const boxes: Box[] = [...opts.obstacles];
  const perGroup = new Map<string, number>();

  for (const item of order) {
    if (!item.required && item.group !== undefined && (perGroup.get(item.group) ?? 0) >= opts.groupLimit) continue;
    let anchor: Box | undefined;
    if (item.anchorId !== undefined) {
      const a = placed.get(item.anchorId);
      const src = items.find((x) => x.id === item.anchorId);
      if (a && src) anchor = { x: a.x, y: a.y, w: src.w, h: src.h };
    }
    const candidates = typeof item.spots === 'function' ? item.spots(anchor) : item.spots;
    let best: { box: Box; overlap: number } | null = null;
    let chosen: Box | null = null;
    for (const c of candidates) {
      const p = clampInto(c, item.w, item.h, opts.clip);
      const box = { x: p.x, y: p.y, w: item.w, h: item.h };
      const overlap = totalOverlap(box, boxes, opts.gap);
      if (overlap === 0) {
        chosen = box;
        break;
      }
      if (!best || overlap < best.overlap) best = { box, overlap };
    }
    const final = chosen ?? (item.required && best ? best.box : null);
    if (!final) continue;
    boxes.push(final);
    placed.set(item.id, { x: final.x, y: final.y, overlaps: chosen === null });
    if (item.group !== undefined && !item.required) perGroup.set(item.group, (perGroup.get(item.group) ?? 0) + 1);
  }
  return placed;
}

/** Bubbles allowed per room at a zoom: one while zoomed out, more as there is space. */
export function bubblesPerRoom(zoom: number): number {
  if (zoom < 1.25) return 1;
  return zoom < 2 ? 2 : 3;
}

/** Name tags need some room to be readable; below this zoom only selected/hovered/waiting people keep one. */
export const NAME_MIN_ZOOM = 0.9;
/** Below this zoom only alerts keep a speech bubble. */
export const BUBBLE_MIN_ZOOM = 0.7;
/** Room pills are shown up to this zoom (above it the rooms' own wall signs are large enough). */
export const ROOM_LABEL_MAX_ZOOM = 2.5;

export interface PillSlot {
  /** Horizontal centre of the pill (centre of the part of the room that is visible). */
  cx: number;
  /** Widest pill that fits inside the visible part of the room. */
  maxWidth: number;
  y: number;
}

const PILL_SIDE_PAD = 4;
const MIN_PILL_ROOM = 24;
const PILL_MIN_TOP = 2;
const PILL_MAX_TOP = 8;

/**
 * Where a room's pill goes: centred in the part of the room that is inside the free area, in the room's top band, and
 * never wider than that part. Null when too little of the room is visible to hold a label.
 */
export function roomPillSlot(room: Box, free: Box, pillH: number, bandH: number): PillSlot | null {
  const left = Math.max(room.x, free.x);
  const right = Math.min(room.x + room.w, free.x + free.w);
  const visibleW = right - left;
  if (visibleW < MIN_PILL_ROOM || room.y > free.y + free.h || room.y + room.h < free.y) return null;
  const inset = Math.max(PILL_MIN_TOP, Math.min(PILL_MAX_TOP, (bandH - pillH) / 2));
  const lowest = room.y + room.h - pillH - PILL_MIN_TOP;
  const y = Math.max(room.y + inset, Math.min(free.y + PILL_MIN_TOP, lowest));
  return { cx: (left + right) / 2, maxWidth: visibleW - PILL_SIDE_PAD * 2, y };
}
