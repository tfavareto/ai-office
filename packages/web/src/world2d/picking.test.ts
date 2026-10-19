import { describe, expect, it } from 'vitest';
import { computeBuilding } from '../layout/building';
import type { RoomState } from '../sim/rooms';
import type { Character } from '../sim/types';
import { characterBox, pickCharacter, pickRoom } from './picking';

function fake(id: string, x: number, y: number, alpha = 1): Character {
  return { id, x, y, alpha } as Character;
}

describe('picking', () => {
  it('picks the character whose body contains the point, front-most first', () => {
    const a = fake('a', 10, 5);
    const b = fake('b', 10, 5.4);
    const box = characterBox(a);
    expect(pickCharacter([a, b], box.x + 4, box.y + 10)?.id).toBe('b');
    expect(pickCharacter([a, b], 0, 0)).toBeNull();
  });

  it('ignores characters that are hidden inside an elevator', () => {
    const a = fake('a', 10, 5, 0.1);
    const box = characterBox(a);
    expect(pickCharacter([a], box.x + 4, box.y + 10)).toBeNull();
  });

  it('finds the project room under a point and nothing for core areas', () => {
    const building = computeBuilding([{ id: 'p1', seed: 3, name: 'p1', slot: 0 }]);
    const area = building.areas.find((a) => a.kind === 'project')!;
    const rooms = [{ areaId: area.id, projectId: 'p1', ghost: false }] as RoomState[];
    const inside = pickRoom(building, rooms, (area.rect.x + 3) * 16, (area.rect.y + 6) * 16);
    expect(inside).toBe('p1');
    expect(pickRoom(building, rooms, 20 * 16, 5 * 16)).toBeNull();
  });
});
