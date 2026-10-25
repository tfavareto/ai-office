// The office pet: a cat that wanders between the rooms and the corridor, naps on the rugs and never gets in anyone's way.
// It is only drawn: the simulation does not know about it, so it cannot block a path, take a seat or change a route.
// Its own walkable grid keeps it out of the decoration and off the tiles where people arrive and enter rooms.
import { cloneGrid, fillRect } from '../layout/grid';
import { Rng } from '../layout/rng';
import { findPath } from '../sim/path';
import type { BuildingLayout, Dir, TilePos } from '../layout/types';
import { decorSlots, floorFootprint } from '../layout/decor';

export type PetMode = 'walk' | 'sit' | 'sleep' | 'groom';

export interface PetPose {
  /** Position of the feet in tile units. */
  x: number;
  y: number;
  dir: Dir;
  mode: PetMode;
  /** Seconds since the mode began (animation clock of the pose). */
  t: number;
  /** 0..1 walk cycle. */
  phase: number;
}

const AREAS = new Set(['reception', 'copa', 'meeting', 'lounge', 'corridor']);
const WALK_SPEED = 1.15;
const KEEP_AWAY = 1.2;
const MIN_REST_S = 7;
const MAX_REST_S = 22;
const STEP_PHASE_PER_TILE = 1.4;
const SLEEP_AFTER_SITS = 2;

function near(a: TilePos, b: { x: number; y: number }, distance: number): boolean {
  return Math.abs(a.x + 0.5 - b.x) < distance && Math.abs(a.y + 0.5 - b.y) < distance;
}

/** The grid the pet walks on: the building's, with the decoration blocked and the doors and elevator fronts kept clear. */
export function petGrid(building: BuildingLayout): BuildingLayout['grid'] {
  const grid = cloneGrid(building.grid);
  for (const slot of decorSlots(building)) {
    const footprint = floorFootprint(slot);
    if (footprint !== undefined) fillRect(grid, footprint, 0);
  }
  return grid;
}

/** The places the pet likes to stop: free floor in the shared rooms and the corridor, away from seats, doors and lifts. */
export function petHubs(building: BuildingLayout, grid = petGrid(building)): TilePos[] {
  const keepClear: { x: number; y: number }[] = [];
  const areas = [...building.areas.filter((area) => AREAS.has(area.id)), building.corridor];
  for (const area of areas) {
    for (const spot of area.spots)
      keepClear.push({ x: spot.x, y: spot.y }, { x: spot.approach.x + 0.5, y: spot.approach.y + 0.5 });
    for (const door of area.doors)
      keepClear.push(
        { x: door.inside.x + 0.5, y: door.inside.y + 0.5 },
        { x: door.outside.x + 0.5, y: door.outside.y + 0.5 },
      );
  }
  for (const elevator of building.elevators)
    for (const tile of elevator.front) keepClear.push({ x: tile.x + 0.5, y: tile.y + 0.5 });
  const hubs: TilePos[] = [];
  for (const area of areas) {
    const rect = area.floor;
    for (let y = rect.y; y < rect.y + rect.h; y++)
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const tile = { x, y };
        if (grid.walkable[y * grid.width + x] !== 1) continue;
        if (keepClear.some((point) => near(tile, point, KEEP_AWAY))) continue;
        hubs.push(tile);
      }
  }
  return hubs;
}

function directionOf(dx: number, dy: number, fallback: Dir): Dir {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : 'n';
}

export class OfficePet {
  private readonly rng: Rng;
  private grid: BuildingLayout['grid'] | null = null;
  private hubs: TilePos[] = [];
  private areaOf = new Map<number, string>();
  private building: BuildingLayout | null = null;
  private path: TilePos[] = [];
  private mode: PetMode = 'sit';
  private modeTime = 0;
  private restFor = MIN_REST_S;
  private sits = 0;
  private position = { x: 0, y: 0 };
  private heading: Dir = 's';
  private phase = 0;
  private placed = false;

  constructor(seed = 7) {
    this.rng = new Rng(seed);
  }

  get pose(): PetPose {
    return {
      x: this.position.x,
      y: this.position.y,
      dir: this.heading,
      mode: this.mode,
      t: this.modeTime,
      phase: this.phase,
    };
  }

  /** Follows the floor plan: when it changes the pet is put back on a free tile of the new one. */
  sync(building: BuildingLayout): void {
    if (this.building === building) return;
    this.building = building;
    this.grid = petGrid(building);
    this.hubs = petHubs(building, this.grid);
    this.areaOf = new Map();
    for (const area of [...building.areas, building.corridor])
      for (let y = area.floor.y; y < area.floor.y + area.floor.h; y++)
        for (let x = area.floor.x; x < area.floor.x + area.floor.w; x++)
          this.areaOf.set(y * building.width + x, area.id);
    const here = { x: Math.floor(this.position.x), y: Math.floor(this.position.y) };
    if (!this.placed || !this.hubs.some((hub) => hub.x === here.x && hub.y === here.y)) this.placeAtRandomHub();
    this.path = [];
  }

  private placeAtRandomHub(): void {
    if (this.hubs.length === 0) return;
    // The first home is a rug in the lounge when there is one: that is where a cat would nap.
    const hub = this.rng.pick(this.hubs);
    this.position = { x: hub.x + 0.5, y: hub.y + 0.6 };
    this.placed = true;
    this.setMode('sit');
  }

  private setMode(mode: PetMode): void {
    this.mode = mode;
    this.modeTime = 0;
    this.phase = 0;
    this.restFor = this.rng.range(MIN_REST_S, MAX_REST_S);
  }

  private chooseDestination(): TilePos | undefined {
    const here = this.areaAt(this.position.x, this.position.y);
    const elsewhere = this.hubs.filter((hub) => this.areaOf.get(hub.y * (this.building?.width ?? 1) + hub.x) !== here);
    const pool = elsewhere.length > 0 && this.rng.chance(0.7) ? elsewhere : this.hubs;
    return pool.length === 0 ? undefined : this.rng.pick(pool);
  }

  private areaAt(x: number, y: number): string | undefined {
    return this.areaOf.get(Math.floor(y) * (this.building?.width ?? 1) + Math.floor(x));
  }

  private startWalk(): void {
    const goal = this.chooseDestination();
    if (goal === undefined || this.grid === null) return this.setMode('sit');
    const path = findPath(this.grid, { x: Math.floor(this.position.x), y: Math.floor(this.position.y) }, goal);
    if (path === null || path.length < 2) return this.setMode('sit');
    this.path = path.slice(1);
    this.setMode('walk');
  }

  private nextRest(): void {
    this.sits++;
    if (this.sits >= SLEEP_AFTER_SITS && this.rng.chance(0.5)) {
      this.sits = 0;
      this.setMode('sleep');
      return;
    }
    this.setMode(this.rng.chance(0.4) ? 'groom' : 'sit');
  }

  /** Advances the pet. With `calm` (reduced motion) it stays where it is, asleep. */
  update(dt: number, calm = false): void {
    if (!this.placed) return;
    this.modeTime += dt;
    if (calm) {
      if (this.mode !== 'sleep') this.setMode('sleep');
      this.path = [];
      return;
    }
    if (this.mode !== 'walk') {
      if (this.modeTime >= this.restFor) this.startWalk();
      return;
    }
    let budget = WALK_SPEED * dt;
    while (budget > 0 && this.path.length > 0) {
      const target = this.path[0];
      const tx = target.x + 0.5;
      const ty = target.y + 0.6;
      const dx = tx - this.position.x;
      const dy = ty - this.position.y;
      const distance = Math.hypot(dx, dy);
      this.heading = directionOf(dx, dy, this.heading);
      if (distance <= budget) {
        this.position = { x: tx, y: ty };
        this.path.shift();
        budget -= distance;
        this.phase = (this.phase + distance * STEP_PHASE_PER_TILE) % 1;
      } else {
        this.position = {
          x: this.position.x + (dx / distance) * budget,
          y: this.position.y + (dy / distance) * budget,
        };
        this.phase = (this.phase + budget * STEP_PHASE_PER_TILE) % 1;
        budget = 0;
      }
    }
    if (this.path.length === 0) this.nextRest();
  }
}
