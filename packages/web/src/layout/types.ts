// Renderer-agnostic floor-plan data: rects, furniture items, spots, doors and the walkable grid.
// Used by the 2D renderer, the simulation and (later) the 3D renderer. Coordinates are tile units, y grows south.

export type Dir = 'n' | 'e' | 's' | 'w';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TilePos {
  x: number;
  y: number;
}

export type AreaKind = 'reception' | 'copa' | 'meeting' | 'bathrooms' | 'lounge' | 'project' | 'corridor' | 'terrace';
export type RowSide = 'north' | 'south';

export type FurnitureKind =
  // workstation
  | 'desk'
  | 'chair'
  | 'shelf'
  | 'copier'
  | 'bin'
  // decor
  | 'plant'
  | 'plantTall'
  | 'rug'
  | 'lamp'
  | 'bench'
  | 'waterCooler'
  | 'sideTable'
  // reception
  | 'receptionDesk'
  | 'sofa'
  | 'armchair'
  | 'coffeeTable'
  // copa
  | 'counter'
  | 'coffeeMachine'
  | 'fridge'
  | 'vending'
  | 'highTable'
  | 'stool'
  | 'roundTable'
  | 'cafeChair'
  // meeting
  | 'meetingTable'
  | 'meetChair'
  // bathrooms
  | 'stall'
  | 'sink'
  // lounge
  | 'pingpong'
  | 'arcade'
  | 'beanbag'
  | 'bookshelf'
  // terrace
  | 'deckChair'
  | 'deckTable'
  | 'railing';

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Visual variant (colour/shape choice inside a kind). */
  variant: number;
  /** Direction the item faces (sofas, chairs...). */
  facing: Dir;
  rotation: 0 | 90 | 180 | 270;
  /** Tiles that block walking (absolute). Empty for rugs and other floor decoration. */
  blocks: Rect[];
  /** Can hide a character standing behind it (drawn again in front of characters by the renderer). */
  tall: boolean;
}

export type WallKind =
  | 'window'
  | 'sign'
  | 'logoSign'
  | 'board'
  | 'tv'
  | 'menu'
  | 'whiteboard'
  | 'elevator'
  | 'mirror'
  | 'poster'
  | 'clock'
  | 'glassDoor';
export type WallSide = 'north' | 'west' | 'east';

/** Decoration mounted on a wall face. `x`/`w` are tile columns (or rows when side is west/east). */
export interface WallItem {
  id: string;
  kind: WallKind;
  side: WallSide;
  x: number;
  w: number;
  variant: number;
}

export type SpotKind =
  | 'desk'
  | 'meeting'
  | 'stool'
  | 'cafe'
  | 'sofa'
  | 'beanbag'
  | 'bench'
  | 'coffee'
  | 'fridge'
  | 'vending'
  | 'sink'
  | 'pingpong'
  | 'arcade'
  | 'tv'
  | 'bookshelf'
  | 'whiteboard'
  | 'cooler'
  | 'talk'
  | 'wait'
  | 'elevator'
  | 'overflow';

/** A place a character can stand or sit. x/y is the position of the feet in tile units. */
export interface Spot {
  id: string;
  kind: SpotKind;
  areaId: string;
  x: number;
  y: number;
  dir: Dir;
  seat: boolean;
  /** Walkable tile the character walks to before stepping/sliding onto the spot. */
  approach: TilePos;
  itemId?: string;
  /** Workstation index inside a project room. */
  deskIndex?: number;
  /** Spots of the same group are used together (talk pairs, ping-pong sides). */
  group?: string;
}

export type DoorKind = 'door' | 'glass' | 'archway';

export interface Door {
  id: string;
  areaId: string;
  kind: DoorKind;
  /** Footprint in tiles (walkable). */
  rect: Rect;
  /** Tile just inside the area, and tile just outside in the corridor. */
  inside: TilePos;
  outside: TilePos;
}

export interface Elevator {
  id: string;
  /** Door tiles in the wall (walkable only for arrival/leaving). */
  rect: Rect;
  /** Walkable tiles in front of the doors. */
  front: TilePos[];
}

export interface AreaTheme {
  /** Floor material used by the painter. */
  floor: 'marble' | 'tile' | 'wood' | 'parquet' | 'stone' | 'carpet' | 'deck' | 'slate';
  /** Main hue 0-360, accent colour (hex) and carpet tints (hex) for project rooms. */
  hue: number;
  accent: string;
  carpet: string;
  carpetAlt: string;
  /** Carpet pattern 0 solid · 1 stripes · 2 checker · 3 diamond. */
  pattern: number;
  /** Wall tone index (0 walnut · 1 oak · 2 ebony). */
  wood: number;
}

export interface AreaLayout {
  id: string;
  kind: AreaKind;
  label: string;
  row: RowSide | 'corridor';
  /** Outer rect including the west wall column, wall rows and ledge. */
  rect: Rect;
  /** North wall face (non-walkable). */
  wall: Rect;
  floor: Rect;
  /** Low south ledge (null for the corridor and terraces). */
  ledge: Rect | null;
  furniture: FurnitureItem[];
  wallItems: WallItem[];
  spots: Spot[];
  doors: Door[];
  theme: AreaTheme;
  /** Project rooms only. */
  projectId?: string;
  /** Slot index of a project room. */
  slot?: number;
}

export interface Grid {
  width: number;
  height: number;
  /** 1 = walkable. */
  walkable: Uint8Array;
}

export interface BuildingLayout {
  /** Footprint of the building in tiles (includes the east wall column). */
  width: number;
  height: number;
  endNorth: number;
  endSouth: number;
  areas: AreaLayout[];
  corridor: AreaLayout;
  terraces: AreaLayout[];
  elevators: Elevator[];
  grid: Grid;
}

export interface RoomSpec {
  /** Project id (or any unique string for a room instance). */
  id: string;
  seed: number;
  name: string;
  slot: number;
  /** Optional id override so a moving room can exist twice (old and new slot) with distinct ids. */
  areaId?: string;
}

export interface SlotPos {
  index: number;
  row: RowSide;
  /** West edge x of the room (its wall column). */
  x: number;
}
