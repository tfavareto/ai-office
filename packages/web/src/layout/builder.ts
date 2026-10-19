import { FLOOR_ROWS, LEDGE_ROWS, NORTH_Y, ROW_H, SOUTH_Y, WALL_ROWS } from './constants';
import type {
  AreaKind, AreaLayout, AreaTheme, Dir, Door, DoorKind, FurnitureItem, FurnitureKind, Rect, RowSide, Spot, SpotKind,
  TilePos, WallItem, WallKind, WallSide,
} from './types';

const TALL_KINDS: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>([
  'desk', 'shelf', 'copier', 'plant', 'plantTall', 'lamp', 'waterCooler', 'receptionDesk', 'counter', 'coffeeMachine',
  'fridge', 'vending', 'highTable', 'roundTable', 'meetingTable', 'stall', 'sink', 'pingpong', 'arcade', 'bookshelf',
  'deckTable', 'railing',
]);

const FACING_ROTATION: Record<Dir, 0 | 90 | 180 | 270> = { n: 0, e: 90, s: 180, w: 270 };

export interface PutOptions {
  variant?: number;
  facing?: Dir;
  /** Does not block walking (rugs, floor decoration). */
  walk?: boolean;
  tall?: boolean;
  /** Custom blocking rects in floor-local tile coordinates (default: the whole footprint). */
  blocks?: Rect[];
}

export interface SpotOptions {
  seat?: boolean;
  /** Approach tile in floor-local integer coordinates (default: the tile under the spot). */
  approach?: TilePos;
  itemId?: string;
  deskIndex?: number;
  group?: string;
}

export interface AreaSpec {
  id: string;
  kind: AreaKind;
  label: string;
  row: RowSide;
  /** West edge (wall column) of the area. */
  x: number;
  width: number;
  theme: AreaTheme;
  projectId?: string;
  slot?: number;
}

/** Builds an AreaLayout using floor-local coordinates (fx, fy) so area recipes read like floor plans. */
export class AreaBuilder {
  readonly area: AreaLayout;
  private counter = 0;

  constructor(spec: AreaSpec) {
    const y0 = spec.row === 'north' ? NORTH_Y : SOUTH_Y;
    const rect: Rect = { x: spec.x, y: y0, w: spec.width, h: ROW_H };
    this.area = {
      id: spec.id,
      kind: spec.kind,
      label: spec.label,
      row: spec.row,
      rect,
      wall: { x: spec.x, y: y0, w: spec.width, h: WALL_ROWS },
      floor: { x: spec.x + 1, y: y0 + WALL_ROWS, w: spec.width - 1, h: FLOOR_ROWS },
      ledge: { x: spec.x, y: y0 + WALL_ROWS + FLOOR_ROWS, w: spec.width, h: LEDGE_ROWS },
      furniture: [],
      wallItems: [],
      spots: [],
      doors: [],
      theme: spec.theme,
      projectId: spec.projectId,
      slot: spec.slot,
    };
  }

  get floorWidth(): number {
    return this.area.floor.w;
  }

  ax(fx: number): number {
    return this.area.floor.x + fx;
  }

  ay(fy: number): number {
    return this.area.floor.y + fy;
  }

  put(kind: FurnitureKind, fx: number, fy: number, w: number, h: number, opts: PutOptions = {}): FurnitureItem {
    const facing = opts.facing ?? 's';
    const x = this.ax(fx);
    const y = this.ay(fy);
    const blocks: Rect[] = opts.walk
      ? []
      : opts.blocks
        ? opts.blocks.map((b) => ({ x: this.ax(b.x), y: this.ay(b.y), w: b.w, h: b.h }))
        : [{ x, y, w, h }];
    const item: FurnitureItem = {
      id: `${this.area.id}:${kind}${this.counter++}`,
      kind,
      x,
      y,
      w,
      h,
      variant: opts.variant ?? 0,
      facing,
      rotation: FACING_ROTATION[facing],
      blocks,
      tall: opts.tall ?? TALL_KINDS.has(kind),
    };
    this.area.furniture.push(item);
    return item;
  }

  wallItem(kind: WallKind, fx: number, w: number, variant = 0, side: WallSide = 'north'): WallItem {
    const item: WallItem = {
      id: `${this.area.id}:w${kind}${this.counter++}`,
      kind,
      side,
      x: side === 'north' ? this.ax(fx) : this.ay(fx),
      w,
      variant,
    };
    this.area.wallItems.push(item);
    return item;
  }

  spot(kind: SpotKind, fx: number, fy: number, dir: Dir, opts: SpotOptions = {}): Spot {
    const approach = opts.approach ?? { x: Math.floor(fx), y: Math.floor(fy) };
    const spot: Spot = {
      id: `${this.area.id}:${kind}${this.counter++}`,
      kind,
      areaId: this.area.id,
      x: this.ax(fx),
      y: this.ay(fy),
      dir,
      seat: opts.seat ?? false,
      approach: { x: this.ax(approach.x), y: this.ay(approach.y) },
      itemId: opts.itemId,
      deskIndex: opts.deskIndex,
      group: opts.group,
    };
    this.area.spots.push(spot);
    return spot;
  }

  /**
   * Door to the corridor: through the ledge for the north row, through the wall face for the south row.
   * `fx` is the first floor column of the door.
   */
  door(fx: number, w: number, kind: DoorKind = 'door'): Door {
    const a = this.area;
    const x = this.ax(fx);
    const north = a.row === 'north';
    const rect: Rect = north ? { x, y: a.ledge!.y, w, h: 1 } : { x, y: a.wall.y, w, h: WALL_ROWS };
    const door: Door = {
      id: `${a.id}:door${a.doors.length}`,
      areaId: a.id,
      kind,
      rect,
      inside: north ? { x, y: a.ledge!.y - 1 } : { x, y: a.floor.y },
      outside: north ? { x, y: a.ledge!.y + 1 } : { x, y: a.wall.y - 1 },
    };
    a.doors.push(door);
    return door;
  }

  build(): AreaLayout {
    return this.area;
  }
}
