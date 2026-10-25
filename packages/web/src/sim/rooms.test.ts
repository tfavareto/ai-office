import { describe, expect, it } from 'vitest';
import type { Project } from '@ai-office/shared';
import { RoomManager } from './rooms';
import { OfficeSim } from './sim';
import { makeAgent, makeProject, makeSnapshot } from './testkit';

const project = (i: number, extra: Partial<Project> = {}): Project => ({ ...makeProject(i), ...extra });
const slots = (rooms: RoomManager): Record<string, number> =>
  Object.fromEntries(rooms.all.filter((r) => !r.ghost).map((r) => [r.projectId.slice(-1), r.slot]));

describe('RoomManager with rooms the person arranged', () => {
  it('puts each room in the slot of its place, new rooms in order', () => {
    const rooms = new RoomManager();
    rooms.sync([
      project(0, { rank: 2, order: 2 }),
      project(1, { rank: 0, order: 0 }),
      project(2, { rank: 1, order: 1 }),
    ]);
    expect(slots(rooms)).toEqual({ 0: 2, 1: 0, 2: 1 });
  });

  it('moves rooms at once when the arrangement changes, keeping the others where they are', () => {
    const rooms = new RoomManager();
    rooms.sync([
      project(0, { order: 0, rank: 0 }),
      project(1, { order: 1, rank: 1 }),
      project(2, { order: 2, rank: 2 }),
    ]);
    rooms.takeMoves();
    const before = rooms.live('/work/proj-0')!;
    rooms.sync([
      project(0, { order: 0, rank: 0 }),
      project(1, { order: 2, rank: 2 }),
      project(2, { order: 1, rank: 1 }),
    ]);
    expect(slots(rooms)).toEqual({ 0: 0, 1: 2, 2: 1 });
    const moves = rooms.takeMoves();
    expect(moves.map((m) => m.projectId).sort()).toEqual(['/work/proj-1', '/work/proj-2']);
    expect(moves.every((m) => m.instant === true && m.fromAreaId === m.toAreaId)).toBe(true);
    expect(rooms.live('/work/proj-0')).toBe(before);
    expect(rooms.live('/work/proj-0')!.areaId).toBe(before.areaId);
  });

  it('shifts the later rooms into the slot of a room that left, once it is dismantled', () => {
    const rooms = new RoomManager();
    const three = [
      project(0, { order: 0, rank: 0 }),
      project(1, { order: 1, rank: 1 }),
      project(2, { order: 2, rank: 2 }),
    ];
    rooms.sync(three);
    rooms.sync([three[0]!, three[2]!]);
    expect(slots(rooms)).toEqual({ 0: 0, 2: 2 });
    rooms.advance(10, () => false);
    expect(slots(rooms)).toEqual({ 0: 0, 2: 1 });
  });

  it('gives a room that arrives the slot of its place and moves the rooms after it', () => {
    const rooms = new RoomManager();
    rooms.sync([project(0, { order: 0, rank: 1 }), project(1, { order: 1, rank: 2 })]);
    rooms.sync([
      project(0, { order: 1, rank: 1 }),
      project(1, { order: 2, rank: 2 }),
      project(2, { order: 0, rank: 0 }),
    ]);
    expect(slots(rooms)).toEqual({ 0: 1, 1: 2, 2: 0 });
    expect(rooms.live('/work/proj-2')!.phase).toBe('building');
  });

  it('keeps the old behaviour of filling freed slots when nothing was arranged', () => {
    const rooms = new RoomManager();
    rooms.sync([project(0), project(1), project(2)]);
    rooms.advance(10, () => false);
    rooms.sync([project(1, { order: 0 }), project(2, { order: 1 })]);
    rooms.advance(10, () => false);
    const moves = rooms.advance(10, () => false).moves.concat(rooms.advance(10, () => false).moves);
    expect(moves.every((m) => m.instant !== true)).toBe(true);
    expect(rooms.takeMoves()).toEqual([]);
  });
});

describe('room themes', () => {
  it('flags a change of theme so the room is drawn again, and only that room', () => {
    const rooms = new RoomManager();
    rooms.sync([project(0), project(1)]);
    expect(rooms.sync([project(0), project(1)])).toBe(false);
    expect(rooms.sync([project(0, { theme: { floor: 'wood' } }), project(1)])).toBe(true);
    expect(rooms.specs().map((spec) => spec.theme)).toEqual([{ floor: 'wood' }, undefined]);
    expect(rooms.sync([project(0, { theme: { floor: 'wood' } }), project(1)])).toBe(false);
  });
});

describe('OfficeSim with rearranged rooms', () => {
  it('seats the people of a room that changed place at their desks in the new place', () => {
    const sim = new OfficeSim(7);
    const agents = [makeAgent('a', 0, 'idle'), makeAgent('b', 1, 'idle')];
    const first = makeSnapshot(2, agents);
    first.projects = [project(0, { order: 0, rank: 0 }), project(1, { order: 1, rank: 1 })];
    sim.setSnapshot(first, 1_000_000);
    sim.runFor(2);
    const second = makeSnapshot(2, agents, 2);
    second.projects = [project(0, { order: 1, rank: 1 }), project(1, { order: 0, rank: 0 })];
    sim.setSnapshot(second, 1_001_000);
    const a = sim.character('a')!;
    expect(sim.areaAt(a.x, a.y)).toBe(sim.rooms.live('/work/proj-0')!.areaId);
    expect(sim.rooms.live('/work/proj-0')!.slot).toBe(1);
    expect(sim.rooms.live('/work/proj-1')!.slot).toBe(0);
  });
});
