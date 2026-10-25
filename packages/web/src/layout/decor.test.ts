import { describe, expect, test } from 'vitest';
import { DECOR_IDS } from '@ai-office/shared';
import { computeBuilding } from './building';
import { decorSlots, floorFootprint, isDrawn, type DecorSlot } from './decor';
import { isWalkable } from './grid';
import type { Rect, RoomSpec } from './types';

const room = (slot: number): RoomSpec => ({ id: `p${slot}`, seed: slot + 1, name: `room${slot}`, slot });
const BUILDING = computeBuilding([room(0), room(1), room(2), room(3), room(4)]);
const SLOTS = decorSlots(BUILDING);

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('decorSlots', () => {
  test('has a place for every piece of decoration', () => {
    expect(new Set(SLOTS.map((slot) => slot.decor))).toEqual(
      new Set(DECOR_IDS.filter((id) => id !== 'pet' && id !== 'goldFinish')),
    );
  });

  test('the corridor garland covers the building in segments', () => {
    const lights = SLOTS.filter((slot) => slot.piece === 'lights');

    expect(lights.length).toBeGreaterThan(3);
    expect(lights[0].x).toBe(1);
    expect(lights.reduce((sum, slot) => sum + slot.w, 0)).toBe(BUILDING.width - 2);
  });

  test('is the same for the same building', () => {
    expect(decorSlots(computeBuilding([room(0), room(1), room(2), room(3), room(4)]))).toEqual(SLOTS);
  });

  test('does not depend on how many project rooms there are, except for the corridor lights', () => {
    const few = decorSlots(computeBuilding([room(0)]));
    const many = decorSlots(computeBuilding(Array.from({ length: 14 }, (_, i) => room(i))));

    expect(few.filter((slot) => slot.piece !== 'lights')).toEqual(SLOTS.filter((slot) => slot.piece !== 'lights'));
    expect(many.filter((slot) => slot.piece === 'lights').length).toBeGreaterThan(
      few.filter((slot) => slot.piece === 'lights').length,
    );
  });

  test('floor pieces stand on free floor: no furniture, no spot, no door', () => {
    const floor = SLOTS.filter((slot) => slot.mount === 'floor');
    expect(floor.length).toBeGreaterThan(0);
    for (const slot of floor) {
      const footprint = floorFootprint(slot) as Rect;
      const area = BUILDING.areas.find((candidate) => candidate.id === slot.areaId);
      expect(area, slot.piece).toBeDefined();
      for (const item of area?.furniture ?? []) {
        if (item.kind === 'rug' || item.decor !== undefined) continue;
        expect(overlaps(footprint, item), `${slot.piece} over ${item.kind}`).toBe(false);
      }
      for (const spot of area?.spots ?? []) {
        expect(
          overlaps(footprint, { x: Math.floor(spot.x), y: Math.floor(spot.y), w: 1, h: 1 }),
          `${slot.piece} over ${spot.kind}`,
        ).toBe(false);
        expect(
          overlaps(footprint, { ...spot.approach, w: 1, h: 1 }),
          `${slot.piece} over the approach to ${spot.kind}`,
        ).toBe(false);
      }
      for (const door of area?.doors ?? []) {
        expect(overlaps(footprint, door.rect)).toBe(false);
        expect(overlaps(footprint, { ...door.inside, w: 1, h: 1 }), `${slot.piece} in the way of a door`).toBe(false);
      }
      for (let y = footprint.y; y < footprint.y + footprint.h; y++)
        for (let x = footprint.x; x < footprint.x + footprint.w; x++)
          expect(isWalkable(BUILDING.grid, x, y), `${slot.piece} is on a tile the floor plan lets people use`).toBe(
            true,
          );
    }
  });

  test('never reaches over the elevator fronts where people arrive', () => {
    for (const elevator of BUILDING.elevators)
      for (const tile of elevator.front)
        for (const slot of SLOTS) {
          const footprint = floorFootprint(slot);
          if (footprint !== undefined) expect(overlaps(footprint, { ...tile, w: 1, h: 1 })).toBe(false);
        }
  });

  test('wall pieces hang where no other wall item is', () => {
    const wall = SLOTS.filter((slot) => slot.mount === 'wall');
    expect(wall.length).toBeGreaterThanOrEqual(4);
    for (const slot of wall) {
      const area = BUILDING.areas.find((candidate) => candidate.id === slot.areaId);
      for (const item of area?.wallItems ?? []) {
        if (item.side !== 'north' || item.decor !== undefined) continue;
        expect(
          overlaps({ x: slot.x, y: 0, w: slot.w, h: 1 }, { x: item.x, y: 0, w: item.w, h: 1 }),
          `${slot.piece} over ${item.kind}`,
        ).toBe(false);
      }
      expect(slot.x).toBeGreaterThanOrEqual(area?.floor.x ?? 0);
      expect(slot.x + slot.w).toBeLessThanOrEqual((area?.rect.x ?? 0) + (area?.rect.w ?? 0));
    }
  });

  test('the plaque hangs on the lower row of the reception desk, clear of the brass plate', () => {
    const plaque = SLOTS.find((slot) => slot.piece === 'plaque') as DecorSlot;
    const desk = BUILDING.areas
      .find((area) => area.id === 'reception')
      ?.furniture.find((item) => item.kind === 'receptionDesk');

    expect(plaque.mount).toBe('desk');
    expect(plaque.y).toBe((desk?.y ?? 0) + (desk?.h ?? 0) - 1);
    expect(plaque.x).toBeGreaterThanOrEqual((desk?.x ?? 0) + 4);
    expect(plaque.x + plaque.w).toBeLessThanOrEqual((desk?.x ?? 0) + (desk?.w ?? 0));
  });
});

describe('the decoration in the layout', () => {
  const decorFurniture = BUILDING.areas
    .concat(BUILDING.corridor)
    .flatMap((area) => area.furniture.filter((item) => item.decor !== undefined));
  const decorWall = BUILDING.areas.flatMap((area) => area.wallItems.filter((item) => item.decor !== undefined));

  test('is part of every layout, one item per slot, tagged with its decoration', () => {
    expect(decorFurniture.length + decorWall.length).toBe(SLOTS.length);
    expect(new Set([...decorFurniture, ...decorWall].map((item) => item.decor))).toEqual(
      new Set(SLOTS.map((slot) => slot.decor)),
    );
  });

  test('blocks nothing: the simulation sees the same floor with and without it', () => {
    for (const item of decorFurniture) expect(item.blocks).toEqual([]);
  });

  test('has unique ids', () => {
    const ids = [...decorFurniture, ...decorWall].map((item) => item.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test('is drawn only when its decoration is unlocked', () => {
    const aquarium = decorFurniture.find((item) => item.kind === 'aquarium') as (typeof decorFurniture)[number];
    const desk = BUILDING.areas[0].furniture.find(
      (item) => item.kind === 'receptionDesk',
    ) as (typeof decorFurniture)[number];

    expect(isDrawn(aquarium, new Set())).toBe(false);
    expect(isDrawn(aquarium, new Set(['aquarium']))).toBe(true);
    expect(isDrawn(desk, new Set())).toBe(true);
  });
});
