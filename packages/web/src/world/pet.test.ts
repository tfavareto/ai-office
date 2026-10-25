import { describe, expect, test } from 'vitest';
import { computeBuilding } from '../layout/building';
import { decorSlots, floorFootprint } from '../layout/decor';
import { isWalkable } from '../layout/grid';
import type { RoomSpec } from '../layout/types';
import { OfficePet, petGrid, petHubs } from './pet';

const room = (slot: number): RoomSpec => ({ id: `p${slot}`, seed: slot + 1, name: `room${slot}`, slot });
const BUILDING = computeBuilding([room(0), room(1), room(2), room(3)]);

function walk(pet: OfficePet, seconds: number, step = 0.1): void {
  for (let t = 0; t < seconds; t += step) pet.update(step);
}

describe('petHubs', () => {
  const hubs = petHubs(BUILDING);

  test('are free floor in the shared rooms and the corridor', () => {
    expect(hubs.length).toBeGreaterThan(20);
    for (const hub of hubs) expect(isWalkable(BUILDING.grid, hub.x, hub.y)).toBe(true);
  });

  test('keep away from the seats, the doors and the elevator fronts', () => {
    for (const hub of hubs) {
      for (const elevator of BUILDING.elevators)
        for (const tile of elevator.front) expect(Math.hypot(hub.x - tile.x, hub.y - tile.y)).toBeGreaterThan(0.9);
      for (const area of BUILDING.areas) {
        for (const door of area.doors)
          expect(Math.hypot(hub.x - door.inside.x, hub.y - door.inside.y)).toBeGreaterThan(0.9);
        for (const spot of area.spots)
          expect(Math.hypot(hub.x + 0.5 - spot.x, hub.y + 0.5 - spot.y)).toBeGreaterThan(1);
      }
    }
  });

  test('are never inside the decoration', () => {
    for (const slot of decorSlots(BUILDING)) {
      const footprint = floorFootprint(slot);
      if (footprint === undefined) continue;
      expect(
        hubs.some(
          (hub) =>
            hub.x >= footprint.x &&
            hub.x < footprint.x + footprint.w &&
            hub.y >= footprint.y &&
            hub.y < footprint.y + footprint.h,
        ),
      ).toBe(false);
    }
  });

  test('cover more than one room', () => {
    const rooms = new Set(
      hubs.map(
        (hub) =>
          BUILDING.areas.find(
            (area) =>
              hub.x >= area.floor.x &&
              hub.x < area.floor.x + area.floor.w &&
              hub.y >= area.floor.y &&
              hub.y < area.floor.y + area.floor.h,
          )?.id ?? 'corridor',
      ),
    );

    expect(rooms.size).toBeGreaterThanOrEqual(4);
  });
});

describe('petGrid', () => {
  test('is the building grid with the decoration blocked', () => {
    const grid = petGrid(BUILDING);
    const aquarium = decorSlots(BUILDING).find((slot) => slot.piece === 'aquarium');

    expect(isWalkable(BUILDING.grid, aquarium?.x ?? 0, aquarium?.y ?? 0)).toBe(true);
    expect(isWalkable(grid, aquarium?.x ?? 0, aquarium?.y ?? 0)).toBe(false);
  });

  test('does not touch the grid the simulation uses', () => {
    const before = BUILDING.grid.walkable.slice();

    petGrid(BUILDING);

    expect(BUILDING.grid.walkable).toEqual(before);
  });
});

describe('OfficePet', () => {
  function make(seed = 3): OfficePet {
    const pet = new OfficePet(seed);
    pet.sync(BUILDING);
    return pet;
  }

  test('starts on a free tile', () => {
    const pose = make().pose;

    expect(isWalkable(petGrid(BUILDING), Math.floor(pose.x), Math.floor(pose.y))).toBe(true);
  });

  test('always stays on tiles of its own grid while it wanders', () => {
    const pet = make();
    const grid = petGrid(BUILDING);

    for (let i = 0; i < 4000; i++) {
      pet.update(0.1);
      const { x, y } = pet.pose;
      expect(isWalkable(grid, Math.floor(x), Math.floor(y)), `at ${x.toFixed(2)},${y.toFixed(2)}`).toBe(true);
    }
  });

  test('wanders between rooms, resting in between', () => {
    const pet = make();
    const visited = new Set<string>();
    const modes = new Set<string>();

    for (let i = 0; i < 6000; i++) {
      pet.update(0.1);
      const { x, y, mode } = pet.pose;
      visited.add(`${Math.floor(x / 16)}:${Math.floor(y / 12)}`);
      modes.add(mode);
    }

    expect(visited.size).toBeGreaterThanOrEqual(3);
    expect(modes.has('walk')).toBe(true);
    expect([...modes].some((mode) => mode !== 'walk')).toBe(true);
  });

  test('walks at a gentle pace', () => {
    const pet = make();
    walk(pet, 120);
    let before = pet.pose;
    let fastest = 0;

    for (let i = 0; i < 1500; i++) {
      pet.update(0.1);
      fastest = Math.max(fastest, Math.hypot(pet.pose.x - before.x, pet.pose.y - before.y) / 0.1);
      before = pet.pose;
    }

    expect(fastest).toBeLessThanOrEqual(1.3);
  });

  test('is deterministic for a seed and different for another', () => {
    const a = make(5);
    const b = make(5);
    const c = make(6);
    walk(a, 200);
    walk(b, 200);
    walk(c, 200);

    expect(a.pose).toEqual(b.pose);
    expect(c.pose).not.toEqual(a.pose);
  });

  test('stays put and asleep when motion is reduced', () => {
    const pet = make();
    const start = pet.pose;

    for (let i = 0; i < 3000; i++) pet.update(0.1, true);

    expect(pet.pose).toMatchObject({ x: start.x, y: start.y, mode: 'sleep' });
  });

  test('is put back on a free tile when the floor plan changes', () => {
    const pet = make();
    const bigger = computeBuilding([room(0), room(1), room(2), room(3), room(4), room(5)]);

    pet.sync(bigger);

    expect(isWalkable(petGrid(bigger), Math.floor(pet.pose.x), Math.floor(pet.pose.y))).toBe(true);
  });
});
