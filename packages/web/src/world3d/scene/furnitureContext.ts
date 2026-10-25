import type { Matrix4 } from 'three';
import type { AreaLayout, FurnitureItem } from '../../layout/types';
import type { Evolution } from '../../world/evolution';
import type { PartCollector } from '../util/parts';
import type { Materials } from './materials';
import type { Models } from './models';

/** Everything a furniture builder needs. Builders draw in item-local space: origin at the footprint centre, front = +z. */
export interface FurnCtx {
  c: PartCollector;
  m: Materials;
  models: Models;
  item: FurnitureItem;
  area: AreaLayout;
  /** What the office has unlocked: the cups in the cabinet, the finish of the metal. */
  evolution: Evolution;
  /** Local footprint size in metres (x across, z deep). */
  w: number;
  d: number;
  /** Item-local to world transform. */
  toWorld: Matrix4;
  /** Registers a monitor screen quad (local transform of its centre, size in metres) for a workstation. */
  screen: (desk: number, slot: number, local: Matrix4, w: number, h: number) => void;
  /** Registers a glow source (lamp halo / light fitting) at an item-local position. */
  light: (x: number, y: number, z: number, warm: boolean) => void;
}
