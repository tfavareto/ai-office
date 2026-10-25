import type { OfficeSnapshot, PendingHire } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { hireAgentId, isHireAgentId, placeholderAgent, waitingHires, withHireProjects } from './hires';
import { OfficeSim } from './sim';
import { makeAgent, makeProject, makeSnapshot } from './testkit';

const HIRE: PendingHire = {
  id: 'h1',
  projectId: '/work/proj-0',
  accountId: 'a1',
  createdAt: 1000,
  expiresAt: 91_000,
  deskIndex: 4,
};

function withHires(snapshot: OfficeSnapshot, hires: PendingHire[], rev = snapshot.rev): OfficeSnapshot {
  return { ...snapshot, rev, hires };
}

function sim(): OfficeSim {
  return new OfficeSim(7);
}

/** The first snapshot (everything already in place), then a hire arrives. */
function officeWithHire(extra: Partial<PendingHire> = {}): OfficeSim {
  const office = sim();
  office.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'idle')]), 1_000_000);
  office.runFor(1);
  office.setSnapshot(withHires(makeSnapshot(1, [makeAgent('ana', 0, 'idle')], 2), [{ ...HIRE, ...extra }]), 1_001_000);
  return office;
}

describe('placeholder helpers', () => {
  it('knows its own agent ids', () => {
    expect(isHireAgentId(hireAgentId('h1'))).toBe(true);
    expect(isHireAgentId('claude:session')).toBe(false);
  });

  it('builds an idle main agent for the hire, always the same person for the same hire', () => {
    const first = placeholderAgent(HIRE);

    expect(first).toMatchObject({
      id: 'hire:h1',
      kind: 'main',
      status: 'idle',
      accountId: 'a1',
      projectId: '/work/proj-0',
    });
    expect(placeholderAgent(HIRE)).toEqual(first);
  });

  it('only hires without a session are waiting', () => {
    expect(waitingHires([HIRE, { ...HIRE, id: 'h2', agentId: 'a1:s' }]).map((hire) => hire.id)).toEqual(['h1']);
    expect(waitingHires(undefined)).toEqual([]);
  });

  it('adds a room for a hire into a folder that has none, with the seed the real room will get', () => {
    const projects = [makeProject(0)];

    const result = withHireProjects(projects, [{ ...HIRE, projectId: '/work/new-app' }, HIRE]);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ id: '/work/new-app', name: 'new-app', path: '/work/new-app', order: 1 });
    expect(result[1]?.seed).toBeGreaterThan(0);
    expect(withHireProjects(projects, [HIRE])).toEqual(projects);
  });
});

describe('a pending hire in the simulation', () => {
  it('walks in through an elevator and sits at the chosen desk', () => {
    const office = officeWithHire();
    const person = office.character('hire:h1')!;

    expect(person.hiring).toBe(true);
    expect(person.moving || person.alpha < 1).toBe(true);

    office.runFor(36);

    const desk = office.building.areas
      .flatMap((area) => area.spots)
      .find((spot) => spot.kind === 'desk' && spot.deskIndex === 4 && spot.areaId === 'room:/work/proj-0')!;
    expect(Math.hypot(person.x - desk.x, person.y - desk.y)).toBeLessThan(0.1);
    expect(person.pose).toBe('sit');
    expect(person.agent.name).toBeTruthy();
  });

  it('stays at its desk instead of wandering off', () => {
    const office = officeWithHire();
    office.runFor(36);
    const person = office.character('hire:h1')!;
    const home = { x: person.x, y: person.y };

    office.runFor(240);

    expect(Math.hypot(person.x - home.x, person.y - home.y)).toBeLessThan(0.1);
    expect(person.pose).toBe('sit');
  });

  it('builds a room for a folder that has none and puts the person in it', () => {
    const office = sim();
    office.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0)]), 1_000_000);
    office.runFor(1);

    office.setSnapshot(
      withHires(makeSnapshot(1, [makeAgent('ana', 0)], 2), [
        { ...HIRE, projectId: '/work/brand-new', deskIndex: undefined },
      ]),
      1_001_000,
    );
    office.runFor(30);

    expect(office.rooms.live('/work/brand-new')?.phase).toBe('open');
    expect(office.character('hire:h1')?.areaId).toBe('room:/work/brand-new');
  });

  it('is handed over to the real agent: same person, same desk, no second trip', () => {
    const office = officeWithHire();
    office.runFor(36);
    const person = office.character('hire:h1')!;
    const where = { x: person.x, y: person.y };

    const real = makeAgent('a1:fresh', 0, 'working');
    office.setSnapshot(
      withHires(makeSnapshot(1, [makeAgent('ana', 0, 'idle'), real], 3), [{ ...HIRE, agentId: real.id }]),
      1_031_000,
    );

    expect(office.character('hire:h1')).toBeUndefined();
    const taken = office.character(real.id)!;
    expect(taken).toBe(person);
    expect(taken.hiring).toBe(false);
    expect(taken.agentId).toBe(real.id);
    expect(taken.name).toBe(real.name);
    expect({ x: taken.x, y: taken.y }).toEqual(where);

    office.runFor(5);

    expect(office.characters.filter((c) => !c.hiring)).toHaveLength(2);
    expect(taken.pose).toBe('type');
    expect(Math.hypot(taken.x - where.x, taken.y - where.y)).toBeLessThan(0.1);
  });

  it('the real agent keeps the claimed desk, so nobody else gets it', () => {
    const office = officeWithHire();
    office.runFor(30);
    const real = makeAgent('a1:fresh', 0, 'working');
    office.setSnapshot(
      withHires(makeSnapshot(1, [makeAgent('ana', 0, 'idle'), real], 3), [{ ...HIRE, agentId: real.id }]),
      1_031_000,
    );
    const desk = office.building.areas
      .flatMap((area) => area.spots)
      .find((spot) => spot.kind === 'desk' && spot.deskIndex === 4 && spot.areaId === 'room:/work/proj-0')!;

    expect(office.spots.claimant(desk.id)).toBe(real.id);
  });

  it('leaves through the elevator when the hire runs out of time', () => {
    const office = officeWithHire();
    office.runFor(30);

    office.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0, 'idle')], 4), 1_091_000);
    office.runFor(30);

    expect(office.character('hire:h1')).toBeUndefined();
  });

  it('arrives straight at the desk when the page opens while a hire is pending', () => {
    const office = sim();

    office.setSnapshot(withHires(makeSnapshot(1, []), [HIRE]), 1_000_000);
    office.runFor(1);

    const person = office.character('hire:h1')!;
    expect(person.pose).toBe('sit');
    expect(person.moving).toBe(false);
  });
});

describe('empty desks', () => {
  function deskCenter(office: OfficeSim, index: number): { x: number; y: number } {
    const desk = office.building.areas
      .find((area) => area.projectId === '/work/proj-0')!
      .furniture.find((item) => item.kind === 'desk' && item.variant === index)!;
    return { x: desk.x + 1.5, y: desk.y + 0.5 };
  }

  it('finds a free desk by its table, its monitors and its chair', () => {
    const office = sim();
    office.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0)]), 1_000_000);
    office.runFor(1);
    const { x, y } = deskCenter(office, 5);

    for (const dy of [-0.5, 0.2, 1.2])
      expect(office.emptyDeskAt(x, y + dy)).toMatchObject({ projectId: '/work/proj-0', deskIndex: 5 });
    expect(office.emptyDeskAt(x, y + 1.5)).toBeNull();
  });

  it('does not offer a desk someone sits at', () => {
    const office = sim();
    office.setSnapshot(makeSnapshot(1, [makeAgent('ana', 0)]), 1_000_000);
    office.runFor(1);
    const taken = office.building.areas
      .flatMap((area) => area.spots)
      .find((spot) => spot.kind === 'desk' && office.spots.claimant(spot.id) === 'ana')!;
    const desk = office.building.areas
      .find((area) => area.projectId === '/work/proj-0')!
      .furniture.find((item) => item.kind === 'desk' && item.variant === taken.deskIndex)!;

    expect(office.emptyDeskAt(desk.x + 1.5, desk.y + 0.5)).toBeNull();
  });

  it('does not offer the desk a pending hire has reserved', () => {
    const office = officeWithHire();
    office.runFor(1);
    const { x, y } = deskCenter(office, 4);

    const free = deskCenter(office, 3);

    expect(office.emptyDeskAt(x, y)).toBeNull();
    expect(office.emptyDeskAt(free.x, free.y)).toMatchObject({ deskIndex: 3 });
  });

  it('does not offer desks of a room that is still being built', () => {
    const office = sim();
    office.setSnapshot(makeSnapshot(1, []), 1_000_000);
    office.runFor(1);
    office.setSnapshot(makeSnapshot(2, [], 2), 1_001_000);
    const area = office.building.areas.find((a) => a.projectId === '/work/proj-1')!;
    const desk = area.furniture.find((item) => item.kind === 'desk')!;

    expect(office.emptyDeskAt(desk.x + 1, desk.y)).toBeNull();
    office.runFor(5);
    expect(office.emptyDeskAt(desk.x + 1, desk.y)).not.toBeNull();
  });
});
