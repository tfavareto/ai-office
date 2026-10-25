// Where the unlockable decoration goes. Pure data derived from the floor plan, shared by the 2D and the 3D renderer so
// both draw the same pieces in the same places. The pieces are part of every layout, tagged with the decoration that
// owns them, and the renderers draw them once it is unlocked. They never touch the walkable grid or the spots: each
// hangs on a wall, stands on floor nobody walks to (kept clear of seats, doors and lifts) or sits on the reception desk.
import type { DecorId } from '@ai-office/shared';
import type { AreaLayout, BuildingLayout, FurnitureItem, FurnitureKind, Rect, WallItem, WallKind } from './types';

export type DecorPiece = 'frame' | 'plaque' | 'aquarium' | 'cabinet' | 'neon' | 'arcade' | 'lights';

export type DecorMount = 'wall' | 'floor' | 'desk' | 'corridor';

export interface DecorSlot {
  decor: DecorId;
  piece: DecorPiece;
  areaId: string;
  mount: DecorMount;
  /**
   * Wall pieces: first tile column and width, `y` the wall's top row. Floor pieces: the tile footprint. The plaque's is
   * the lower row of the reception desk's front. Lights hang in the corridor in segments.
   */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which art, machine or colour of a piece that exists more than once. */
  variant: number;
}

interface Recipe {
  decor: DecorId;
  piece: DecorPiece;
  area: string;
  mount: DecorMount;
  /** Floor-local column and row (the area's floor starts at its first tile). */
  fx: number;
  fy: number;
  w: number;
  h: number;
  variant: number;
}

const RECIPES: readonly Recipe[] = [
  { decor: 'wallArt', piece: 'frame', area: 'reception', mount: 'wall', fx: 11, fy: 0, w: 1, h: 1, variant: 0 },
  { decor: 'wallArt', piece: 'frame', area: 'copa', mount: 'wall', fx: 7, fy: 0, w: 2, h: 1, variant: 1 },
  { decor: 'wallArt', piece: 'frame', area: 'meeting', mount: 'wall', fx: 2, fy: 0, w: 2, h: 1, variant: 2 },
  { decor: 'aquarium', piece: 'aquarium', area: 'lounge', mount: 'floor', fx: 9, fy: 0, w: 2, h: 1, variant: 0 },
  { decor: 'trophyCabinet', piece: 'cabinet', area: 'reception', mount: 'floor', fx: 1, fy: 2, w: 2, h: 1, variant: 0 },
  { decor: 'neonSign', piece: 'neon', area: 'copa', mount: 'wall', fx: 0, fy: 0, w: 3, h: 1, variant: 0 },
  { decor: 'arcade', piece: 'arcade', area: 'lounge', mount: 'floor', fx: 11, fy: 0, w: 1, h: 1, variant: 2 },
  { decor: 'arcade', piece: 'arcade', area: 'lounge', mount: 'floor', fx: 14, fy: 0, w: 1, h: 1, variant: 3 },
];

/** The plaque hangs on the desk front, beside the brass "AI OFFICE" plate. */
const PLAQUE_OFFSET = 4;
const PLAQUE_W = 3;
/** The garland of the corridor comes in segments of this many tiles. */
const LIGHTS_SEGMENT = 8;
const LIGHTS_FROM = 1;

function areaIn(building: BuildingLayout, id: string): AreaLayout | undefined {
  return id === building.corridor.id ? building.corridor : building.areas.find((area) => area.id === id);
}

function slotOf(recipe: Recipe, area: AreaLayout): DecorSlot {
  const wall = recipe.mount === 'wall';
  return {
    decor: recipe.decor,
    piece: recipe.piece,
    areaId: area.id,
    mount: recipe.mount,
    x: area.floor.x + recipe.fx,
    y: wall ? area.wall.y : area.floor.y + recipe.fy,
    w: recipe.w,
    h: recipe.h,
    variant: recipe.variant,
  };
}

/** Every piece of decoration the building has room for, whether or not it is unlocked (see `unlockedSlots`). */
export function decorSlots(building: BuildingLayout): DecorSlot[] {
  const slots: DecorSlot[] = [];
  for (const recipe of RECIPES) {
    const area = areaIn(building, recipe.area);
    if (area !== undefined) slots.push(slotOf(recipe, area));
  }
  const reception = areaIn(building, 'reception');
  const desk = reception?.furniture.find((item) => item.kind === 'receptionDesk');
  if (reception !== undefined && desk !== undefined)
    slots.push({
      decor: 'employeePlaque',
      piece: 'plaque',
      areaId: reception.id,
      mount: 'desk',
      x: desk.x + PLAQUE_OFFSET,
      y: desk.y + desk.h - 1,
      w: PLAQUE_W,
      h: 1,
      variant: 0,
    });
  const corridor = building.corridor;
  for (let x = LIGHTS_FROM, index = 0; x < building.width - 1; x += LIGHTS_SEGMENT, index++)
    slots.push({
      decor: 'stringLights',
      piece: 'lights',
      areaId: corridor.id,
      mount: 'corridor',
      x,
      y: corridor.rect.y,
      w: Math.min(LIGHTS_SEGMENT, building.width - 1 - x),
      h: 1,
      variant: index,
    });
  return slots;
}

const FURNITURE_KIND: Partial<Record<DecorPiece, FurnitureKind>> = {
  aquarium: 'aquarium',
  cabinet: 'trophyCabinet',
  plaque: 'plaque',
  arcade: 'arcade',
  lights: 'lights',
};
const WALL_KIND: Partial<Record<DecorPiece, WallKind>> = { frame: 'frame', neon: 'neon' };
/** Pieces that can hide a person standing behind them. */
const TALL_PIECES: ReadonlySet<DecorPiece> = new Set<DecorPiece>(['aquarium', 'cabinet', 'arcade', 'lights']);

/**
 * Adds every piece of decoration to the areas of a building, tagged with its decoration. Called by `computeBuilding`
 * once the areas exist; the items block nothing, so the walkable grid and the simulation are exactly what they were.
 */
export function attachDecor(building: BuildingLayout): void {
  const counters = new Map<string, number>();
  for (const slot of decorSlots(building)) {
    const area = areaIn(building, slot.areaId);
    if (area === undefined) continue;
    const n = counters.get(area.id) ?? 0;
    counters.set(area.id, n + 1);
    const wallKind = WALL_KIND[slot.piece];
    if (wallKind !== undefined) {
      const item: WallItem = {
        id: `${area.id}:decor:${slot.piece}${n}`,
        kind: wallKind,
        side: 'north',
        x: slot.x,
        w: slot.w,
        variant: slot.variant,
        decor: slot.decor,
      };
      area.wallItems.push(item);
      continue;
    }
    const kind = FURNITURE_KIND[slot.piece];
    if (kind === undefined) continue;
    const item: FurnitureItem = {
      id: `${area.id}:decor:${slot.piece}${n}`,
      kind,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      variant: slot.variant,
      facing: 's',
      rotation: 0,
      blocks: [],
      tall: TALL_PIECES.has(slot.piece),
      decor: slot.decor,
    };
    area.furniture.push(item);
  }
}

/** Whether a layout item is drawn: ordinary items always, decoration only once unlocked. */
export function isDrawn(item: { decor?: DecorId }, unlocked: ReadonlySet<DecorId>): boolean {
  return item.decor === undefined || unlocked.has(item.decor);
}

/** The tile rectangle a slot occupies on the floor (wall and desk pieces occupy none of their own). */
export function floorFootprint(slot: DecorSlot): Rect | undefined {
  return slot.mount === 'floor' ? { x: slot.x, y: slot.y, w: slot.w, h: slot.h } : undefined;
}
