import { describe, expect, it } from 'vitest';
import { OfficeSim } from './sim';
import { makeAgent, makeSnapshot } from './testkit';
import { BUILD_SECONDS } from './rooms';
import { BubbleManager } from './bubbles';
import { findPath, smoothPath } from './path';
import { createGrid, fillRect } from '../layout/grid';

function seeded(): OfficeSim {
  const sim = new OfficeSim(7);
  sim.setOptions({ bubbles: 'all' });
  return sim;
}

describe('pathfinding', () => {
  it('finds a path around a wall and refuses diagonal corner cutting', () => {
    const grid = createGrid(8, 8);
    fillRect(grid, { x: 0, y: 0, w: 8, h: 8 }, 1);
    fillRect(grid, { x: 3, y: 0, w: 1, h: 6 }, 0);
    const tiles = findPath(grid, { x: 1, y: 1 }, { x: 6, y: 1 })!;
    expect(tiles[0]).toEqual({ x: 1, y: 1 });
    expect(tiles.at(-1)).toEqual({ x: 6, y: 1 });
    expect(tiles.some((t) => t.y >= 6)).toBe(true);
    for (const t of tiles) expect(grid.walkable[t.y * 8 + t.x] === 1 || (t.x === 1 && t.y === 1)).toBe(true);
  });

  it('returns null when the goal is enclosed and allows a blocked goal tile that is reachable', () => {
    const grid = createGrid(5, 5);
    fillRect(grid, { x: 0, y: 0, w: 5, h: 5 }, 1);
    fillRect(grid, { x: 1, y: 1, w: 3, h: 3 }, 0);
    fillRect(grid, { x: 2, y: 2, w: 1, h: 1 }, 1);
    expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 })).toBeNull();
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 })).not.toBeNull();
  });

  it('smooths a staircase into few straight segments', () => {
    const grid = createGrid(10, 10);
    fillRect(grid, { x: 0, y: 0, w: 10, h: 10 }, 1);
    const tiles = findPath(grid, { x: 0, y: 0 }, { x: 8, y: 5 })!;
    expect(smoothPath(grid, tiles).length).toBeLessThanOrEqual(2);
  });
});

describe('simulation', () => {
  it('places agents of the first snapshot straight at their desks', () => {
    const sim = seeded();
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0), makeAgent('bia', 0)]), 1_000_000);
    sim.runFor(1);
    const ana = sim.character('ana')!;
    expect(ana.pose).toBe('type');
    expect(ana.seat).toBe('desk');
    expect(sim.areaAt(ana.x, ana.y)).toBe('room:/work/proj-0');
  });

  it('brings a new agent in through an elevator, walks it to its desk and types', () => {
    const sim = seeded();
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0)]), 1_000_000);
    sim.runFor(1);
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0), makeAgent('caio', 0)], 2), 1_001_000);
    const caio = sim.character('caio')!;
    expect(caio.alpha).toBe(0);
    const door = sim.building.elevators[0].rect;
    expect(Math.abs(caio.y - (door.y + 0.5))).toBeLessThan(0.01);
    let sawElevatorOpen = false;
    for (let i = 0; i < 40 * 30; i++) {
      sim.runFor(1 / 30);
      if (sim.elevatorOpenness(0) > 0.5 || sim.elevatorOpenness(1) > 0.5) sawElevatorOpen = true;
    }
    expect(sawElevatorOpen).toBe(true);
    expect(caio.alpha).toBe(1);
    expect(caio.pose).toBe('type');
    expect(caio.seat).toBe('desk');
  });

  it('gives two agents of one project different desks', () => {
    const sim = seeded();
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0), makeAgent('bia', 0)]), 1_000_000);
    const a = sim.character('ana')!;
    const b = sim.character('bia')!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });

  it('reacts to statuses: waiting raises a hand with an alert, idle sits relaxed', () => {
    const sim = seeded();
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0)]), 1_000_000);
    sim.runFor(1);
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'waiting', { waitingFor: 'Responder uma pergunta' })], 2), 1_001_000);
    sim.runFor(2);
    const ana = sim.character('ana')!;
    expect(ana.pose).toBe('hand');
    expect(ana.alert).toBe(true);
    expect(sim.bubbles.some((b) => b.agentId === 'ana' && b.sticky)).toBe(true);
    expect(sim.bubbles.find((b) => b.agentId === 'ana' && b.sticky)).toMatchObject({ text: 'Precisa de você', msg: { key: 'bubble.needsYou' } });
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'idle')], 3), 1_002_000);
    sim.runFor(0.5);
    expect(['sit', 'celebrate']).toContain(sim.character('ana')!.pose);
    expect(sim.bubbles.some((b) => b.agentId === 'ana' && b.sticky)).toBe(false);
  });

  it('leans back, stretches, eats popcorn and naps while a foreground shell runs', () => {
    const sim = seeded();
    const shell = { id: 's', label: 'npm test', background: false, kind: 'shell' as const, startedAt: 1_000_000 - 1000 };
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'working', { shells: [shell] })]), 1_000_000);
    sim.runFor(1);
    expect(sim.character('ana')!.pose).toBe('lean');
    const poses: string[] = [];
    for (const t of [70, 200, 500]) {
      sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'working', { shells: [shell] })]), 1_000_000 + t * 1000 - 1000 + 1000);
      sim.runFor(0.2);
      poses.push(sim.character('ana')!.pose);
    }
    expect(poses).toEqual(['stretch', 'popcorn', 'sleep']);
  });

  it('seats subagents at the meeting table', () => {
    const sim = seeded();
    const sub = makeAgent('sub1', 0, 'working', { kind: 'sub', parentId: 'ana', role: 'Explore' });
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0), sub]), 1_000_000);
    const c = sim.character('sub1')!;
    expect(sim.areaAt(c.x, c.y)).toBe('meeting');
  });

  it('lets finished agents walk to an elevator, fade out and be removed', () => {
    const sim = seeded();
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0)]), 1_000_000);
    sim.runFor(1);
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'offline')], 2), 1_001_000);
    let removed = false;
    for (let i = 0; i < 60 * 30 && !removed; i++) {
      sim.runFor(1 / 30);
      removed = sim.character('ana') === undefined;
    }
    expect(removed).toBe(true);
  });

  it('makes idle agents leave their desk eventually, and come back', () => {
    const sim = seeded();
    sim.setOptions({ liveliness: 'lively' });
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'idle')]), 1_000_000);
    const ana = sim.character('ana')!;
    const home = { x: ana.x, y: ana.y };
    let wandered = false;
    for (let i = 0; i < 240 * 30 && !wandered; i++) {
      sim.runFor(1 / 30);
      wandered = Math.hypot(ana.x - home.x, ana.y - home.y) > 3;
    }
    expect(wandered).toBe(true);
  });

  it('keeps idle agents at their desks with reduced motion', () => {
    const sim = seeded();
    sim.setOptions({ reducedMotion: true });
    sim.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'idle')]), 1_000_000);
    const ana = sim.character('ana')!;
    const home = { x: ana.x, y: ana.y };
    sim.runFor(300);
    expect(Math.hypot(ana.x - home.x, ana.y - home.y)).toBeLessThan(0.1);
  });
});

describe('room lifecycle', () => {
  it('builds a new room, then compacts the farthest room into a freed slot with people walking over', () => {
    const sim = seeded();
    sim.setSnapshot(makeSnapshot(3, [makeAgent('a', 0), makeAgent('b', 1), makeAgent('c', 2)]), 1_000_000);
    expect(sim.roomStates.map((r) => r.slot)).toEqual([0, 1, 2]);
    const snapshot = makeSnapshot(3, [makeAgent('a', 0), makeAgent('b', 1), makeAgent('c', 2)], 2);
    snapshot.projects = snapshot.projects.filter((p) => p.name !== 'proj-0');
    snapshot.agents = snapshot.agents.filter((a) => a.id !== 'a');
    sim.setSnapshot(snapshot, 1_001_000);
    sim.runFor(BUILD_SECONDS + 6);
    const live = sim.roomStates.filter((r) => !r.ghost);
    expect(live.map((r) => r.slot).sort()).toEqual([0, 1]);
    expect(sim.roomStates.some((r) => r.ghost)).toBe(false);
    const moved = sim.rooms.live('/work/proj-2')!;
    expect(moved.slot).toBe(0);
    sim.runFor(40);
    const c = sim.character('c')!;
    expect(sim.areaAt(c.x, c.y)).toBe(moved.areaId);
    expect(c.pose).toBe('type');
  });

  it('plays a build-in animation for rooms that appear after the first snapshot', () => {
    const sim = seeded();
    sim.setSnapshot(makeSnapshot(1, [makeAgent('a', 0)]), 1_000_000);
    expect(sim.rooms.live('/work/proj-0')!.progress).toBe(1);
    sim.setSnapshot(makeSnapshot(2, [makeAgent('a', 0), makeAgent('b', 1)], 2), 1_001_000);
    const room = sim.rooms.live('/work/proj-1')!;
    expect(room.phase).toBe('building');
    sim.runFor(BUILD_SECONDS / 2);
    expect(room.progress).toBeGreaterThan(0.3);
    sim.runFor(BUILD_SECONDS);
    expect(room.phase).toBe('open');
  });
});

describe('bubble rationing', () => {
  const candidate = (agentId: string, roomId: string, importance: number) => ({
    agentId, roomId, text: agentId, icon: 'x', importance, sticky: false, ttl: 4,
  });

  it('caps visible bubbles per room by liveliness and keeps the most important', () => {
    const m = new BubbleManager();
    m.configure('all', 'normal');
    for (const [id, imp] of [['a', 10], ['b', 40], ['c', 90], ['d', 20]] as const) m.offer(candidate(id, 'r1', imp), 0);
    const visible = m.update(0, () => 'r1');
    expect(visible.map((b) => b.agentId).sort()).toEqual(['b', 'c']);
  });

  it('filters by mode: important keeps only high importance, none shows nothing', () => {
    const m = new BubbleManager();
    m.configure('important', 'lively');
    m.offer(candidate('a', 'r', 20), 0);
    m.offer(candidate('b', 'r', 80), 0);
    expect(m.update(0, () => 'r').map((b) => b.agentId)).toEqual(['b']);
    m.configure('none', 'lively');
    expect(m.update(1, () => 'r')).toHaveLength(0);
  });

  it('expires bubbles and lets waiting ones appear afterwards', () => {
    const m = new BubbleManager();
    m.configure('all', 'calm');
    m.offer(candidate('a', 'r', 30), 0);
    m.offer(candidate('b', 'r', 20), 0);
    expect(m.update(0, () => 'r').map((b) => b.agentId)).toEqual(['a']);
    expect(m.update(4.5, () => 'r').map((b) => b.agentId)).toEqual(['b']);
  });

  it('never rations sticky alerts', () => {
    const m = new BubbleManager();
    m.configure('all', 'calm');
    m.offer(candidate('a', 'r', 30), 0);
    m.offer({ ...candidate('b', 'r', 100), sticky: true }, 0);
    m.offer({ ...candidate('c', 'r', 100), sticky: true }, 0);
    expect(m.update(0, () => 'r').filter((b) => b.sticky)).toHaveLength(2);
  });
});
