// Where the user dragged things on the canvas, remembered in this browser. Offsets are relative to where the layout
// puts a cluster or a terminal, so the layout keeps working as sessions come and go. Everything read back is validated.
import type { Point } from './geometry';

export const POSITIONS_KEY = 'ai-office:pro-layout';
const MAX_ENTRIES = 300;
const MAX_KEY_LENGTH = 200;
const MAX_OFFSET = 50_000;

export interface ProPositions {
  /** Offset of a whole cluster, by the orchestrator's agent id. */
  clusters: Readonly<Record<string, Point>>;
  /** Offset of one terminal on top of its cluster's, by agent id. */
  panels: Readonly<Record<string, Point>>;
}

export const EMPTY_POSITIONS: ProPositions = { clusters: {}, panels: {} };

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function parseOffset(value: unknown): Point | null {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > MAX_OFFSET || Math.abs(y) > MAX_OFFSET) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function parseOffsets(raw: unknown): Record<string, Point> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const result: Record<string, Point> = {};
  for (const [key, value] of Object.entries(raw).slice(-MAX_ENTRIES)) {
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) continue;
    const offset = parseOffset(value);
    if (offset !== null && (offset.x !== 0 || offset.y !== 0)) result[key] = offset;
  }
  return result;
}

export function parsePositions(raw: unknown): ProPositions {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return EMPTY_POSITIONS;
  const data = raw as Record<string, unknown>;
  return { clusters: parseOffsets(data.clusters), panels: parseOffsets(data.panels) };
}

export function parsePositionsJson(text: string | null): ProPositions {
  if (text === null) return EMPTY_POSITIONS;
  try {
    return parsePositions(JSON.parse(text));
  } catch {
    return EMPTY_POSITIONS;
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPositions(storage: StorageLike | null = defaultStorage()): ProPositions {
  if (storage === null) return EMPTY_POSITIONS;
  try {
    return parsePositionsJson(storage.getItem(POSITIONS_KEY));
  } catch {
    return EMPTY_POSITIONS;
  }
}

export function savePositions(positions: ProPositions, storage: StorageLike | null = defaultStorage()): boolean {
  if (storage === null) return false;
  try {
    if (Object.keys(positions.clusters).length === 0 && Object.keys(positions.panels).length === 0)
      storage.removeItem(POSITIONS_KEY);
    else storage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    return true;
  } catch {
    return false;
  }
}

function withEntry(map: Readonly<Record<string, Point>>, key: string, offset: Point): Record<string, Point> {
  const others = Object.entries(map).filter(([existing]) => existing !== key);
  const moved = offset.x !== 0 || offset.y !== 0;
  return Object.fromEntries((moved ? [...others, [key, offset]] : others).slice(-MAX_ENTRIES));
}

/** Remembers a cluster's offset (a zero offset forgets it). */
export function withClusterOffset(positions: ProPositions, id: string, offset: Point): ProPositions {
  return { ...positions, clusters: withEntry(positions.clusters, id, offset) };
}

/** Remembers a terminal's offset (a zero offset forgets it). */
export function withPanelOffset(positions: ProPositions, id: string, offset: Point): ProPositions {
  return { ...positions, panels: withEntry(positions.panels, id, offset) };
}

export function hasPositions(positions: ProPositions): boolean {
  return Object.keys(positions.clusters).length > 0 || Object.keys(positions.panels).length > 0;
}
