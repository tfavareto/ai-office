import { describe, expect, it } from 'vitest';
import { EncounterDirector, type PersonView } from './encounters';

const person = (id: string, over: Partial<PersonView> = {}): PersonView => ({
  id,
  kind: 'main',
  projectId: 'p',
  areaId: 'room:p',
  x: 5,
  y: 5,
  dir: 's',
  status: 'working',
  free: true,
  moving: false,
  leaving: false,
  ...over,
});

const sub = (id: string, parentId = 'ana', over: Partial<PersonView> = {}): PersonView =>
  person(id, { kind: 'sub', parentId, areaId: 'meeting', x: 30, y: 4, ...over });

describe('encounter director', () => {
  it('sends the main agent to greet a subagent that sat down', () => {
    const d = new EncounterDirector(1);
    d.noteArrival('s1', 10);
    const orders = d.plan([person('ana'), sub('s1')], 11);
    expect(orders).toEqual([
      expect.objectContaining({ kind: 'handshake', walker: 'ana', host: 's1', bothWalk: false }),
    ]);
  });

  it('waits for a main agent that is busy and gives up after a while', () => {
    const d = new EncounterDirector(1);
    d.noteArrival('s1', 10);
    const busy = [person('ana', { free: false }), sub('s1')];
    expect(d.plan(busy, 12)).toEqual([]);
    expect(d.plan([person('ana'), sub('s1')], 12)[0]?.kind).toBe('handshake');
    const late = new EncounterDirector(1);
    late.noteArrival('s1', 10);
    expect(late.plan([person('ana'), sub('s1')], 40)).toEqual([]);
  });

  it('never calls away a main agent that waits for the user', () => {
    const d = new EncounterDirector(1);
    d.noteArrival('s1', 10);
    expect(d.plan([person('ana', { status: 'waiting' }), sub('s1')], 11)).toEqual([]);
  });

  it('greets a departing subagent only when its main agent is free and close enough', () => {
    const d = new EncounterDirector(1);
    const near = [person('ana', { x: 20, y: 4 }), sub('s1')];
    expect(d.farewell(near, 's1', 100)).toMatchObject({ kind: 'handshake', walker: 'ana', host: 's1' });
    expect(new EncounterDirector(1).farewell([person('ana', { x: 90, y: 4 }), sub('s1')], 's1', 100)).toBeNull();
    expect(new EncounterDirector(1).farewell([person('ana', { free: false }), sub('s1')], 's1', 100)).toBeNull();
  });

  it('high-fives two colleagues of a room that celebrate within seconds of each other', () => {
    const d = new EncounterDirector(1);
    d.noteCelebration('ana', 'p', 10);
    d.noteCelebration('bia', 'p', 13);
    const orders = d.plan([person('ana'), person('bia', { x: 9 })], 13.5);
    expect(orders).toEqual([expect.objectContaining({ kind: 'highfive', bothWalk: true })]);
  });

  it('does not high-five across rooms, far apart or when too much time has passed', () => {
    const far = new EncounterDirector(1);
    far.noteCelebration('ana', 'p', 10);
    far.noteCelebration('bia', 'p', 12);
    expect(far.plan([person('ana'), person('bia', { x: 60 })], 12)).toEqual([]);
    const other = new EncounterDirector(1);
    other.noteCelebration('ana', 'p', 10);
    other.noteCelebration('bia', 'q', 11);
    expect(other.plan([person('ana'), person('bia', { projectId: 'q' })], 11)).toEqual([]);
    const slow = new EncounterDirector(1);
    slow.noteCelebration('ana', 'p', 10);
    slow.noteCelebration('bia', 'p', 25);
    expect(slow.plan([person('ana'), person('bia')], 25)).toEqual([]);
  });

  it('spaces encounters across the office', () => {
    const d = new EncounterDirector(1);
    d.noteArrival('s1', 10);
    d.noteArrival('s2', 10);
    const people = [person('ana'), person('bob'), sub('s1', 'ana'), sub('s2', 'bob')];
    expect(d.plan(people, 11)).toHaveLength(1);
    expect(d.plan(people, 12)).toEqual([]);
    expect(d.plan(people, 20)).toHaveLength(1);
  });

  it('checks on a working subagent now and then, with a cooldown per main agent', () => {
    const people = [person('ana'), sub('s1')];
    let started = 0;
    const d = new EncounterDirector(3);
    for (let t = 0; t < 400; t += 7) started += d.plan(people, t).filter((o) => o.kind === 'check').length;
    expect(started).toBeGreaterThan(0);
    expect(started).toBeLessThanOrEqual(Math.ceil(400 / 90) + 1);
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number): number[] => {
      const d = new EncounterDirector(seed);
      const people = [person('ana'), sub('s1')];
      const times: number[] = [];
      for (let t = 0; t < 600; t += 7) if (d.plan(people, t).length) times.push(t);
      return times;
    };
    expect(run(5)).toEqual(run(5));
  });

  it('waves when two people walking in the corridor pass each other, once per pair for a while', () => {
    let waved = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const d = new EncounterDirector(seed);
      const a = person('ana', { areaId: 'corridor', moving: true, dir: 'e', x: 10, y: 3 });
      const b = person('bia', { areaId: 'corridor', moving: true, dir: 'w', x: 11, y: 3 });
      const first = d.waves([a, b], 100);
      waved += first.length;
      expect(d.waves([a, b], 101)).toEqual([]);
    }
    expect(waved).toBeGreaterThan(5);
  });

  it('does not wave at people walking the same way, standing, or far away', () => {
    const d = new EncounterDirector(1);
    const walk = (id: string, dir: 'e' | 'w', x: number, moving = true): PersonView =>
      person(id, { areaId: 'corridor', moving, dir, x });
    expect(d.waves([walk('a', 'e', 10), walk('b', 'e', 11)], 100)).toEqual([]);
    expect(d.waves([walk('a', 'e', 10), walk('b', 'w', 11, false)], 100)).toEqual([]);
    expect(d.waves([walk('a', 'e', 10), walk('b', 'w', 15)], 100)).toEqual([]);
  });
});
