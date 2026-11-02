import type { Agent, Project } from '@ai-office/shared';
import { describe, expect, test } from 'vitest';
import type { Scene, SceneCluster } from './scene';
import { MAX_SQUADS, addSquad, foldSquads, parseSquads, removeSquad, validSquad } from './squads';

const lead = { name: 'Lead', instructions: 'Lead it' };
const tester = { name: 'Tester', instructions: 'Test it' };

function cluster(id: string, squad?: string): SceneCluster {
  const main = { id, name: id, ...(squad !== undefined ? { terminalSquad: squad } : {}) } as Agent;
  return { main, subs: [], collapsed: [], layout: { id, rows: 0, slots: {} } };
}

function sceneOf(...clusters: SceneCluster[]): Scene {
  return { rooms: [{ project: { id: 'room' } as Project, clusters }], memory: new Map() };
}

const shownIds = (scene: Scene): string[] => scene.rooms[0]?.clusters.map((one) => one.main.id) ?? [];

describe('validSquad', () => {
  test('needs a name and from two to five valid members', () => {
    expect(validSquad('Trio', [lead, tester])).toBe(true);
    expect(validSquad(' ', [lead, tester])).toBe(false);
    expect(validSquad('Solo', [lead])).toBe(false);
    expect(
      validSquad(
        'Crowd',
        Array.from({ length: 6 }, () => lead),
      ),
    ).toBe(false);
    expect(validSquad('Bad', [lead, { name: '', instructions: 'x' }])).toBe(false);
  });
});

describe('addSquad and removeSquad', () => {
  test('saving under the same name replaces it, newest first', () => {
    // Arrange
    const first = addSquad([], { id: 'a', name: 'Trio', members: [lead, tester] });

    // Act
    const next = addSquad(first, { id: 'b', name: ' trio ', members: [tester, lead] });

    // Assert
    expect(next.map((squad) => squad.id)).toEqual(['b']);
    expect(next[0]?.name).toBe('trio');
  });

  test('keeps a limited list and removes by id', () => {
    // Arrange
    let list = addSquad([], { id: 's0', name: 'n0', members: [lead, tester] });
    for (let index = 1; index <= MAX_SQUADS; index += 1)
      list = addSquad(list, { id: `s${index}`, name: `n${index}`, members: [lead, tester] });

    // Act
    const removed = removeSquad(list, `s${MAX_SQUADS}`);

    // Assert
    expect(list).toHaveLength(MAX_SQUADS);
    expect(removed).toHaveLength(MAX_SQUADS - 1);
  });
});

describe('parseSquads', () => {
  test('keeps what is valid and forgets the rest', () => {
    // Arrange
    const raw = [
      { id: 'a', name: 'Trio', members: [lead, tester] },
      { id: 'b', name: 'Solo', members: [lead] },
      { id: 'c', name: 'Odd', members: [lead, 7] },
      'nope',
    ];

    // Act and assert
    expect(parseSquads(raw).map((squad) => squad.id)).toEqual(['a']);
    expect(parseSquads('nope')).toEqual([]);
  });
});

describe('foldSquads', () => {
  test('a squad is one block, in the place of its first member', () => {
    // Arrange
    const scene = sceneOf(cluster('alone'), cluster('a', 's'), cluster('b', 's'), cluster('c', 's'));

    // Act
    const folded = foldSquads(scene, new Set(), new Map());

    // Assert
    expect(shownIds(folded)).toEqual(['alone', 'a']);
    expect(folded.rooms[0]?.clusters[1]?.squad).toMatchObject({ id: 's', currentId: 'a', folded: true });
    expect(folded.rooms[0]?.clusters[1]?.squad?.members.map((member) => member.id)).toEqual(['a', 'b', 'c']);
    expect(folded.rooms[0]?.clusters[0]?.squad).toBeUndefined();
  });

  test('shows the member chosen last, in the same place', () => {
    // Arrange
    const scene = sceneOf(cluster('a', 's'), cluster('b', 's'), cluster('alone'));

    // Act
    const folded = foldSquads(scene, new Set(), new Map([['s', 'b']]));

    // Assert
    expect(shownIds(folded)).toEqual(['b', 'alone']);
  });

  test('a member chosen that already left falls back to the first', () => {
    const folded = foldSquads(sceneOf(cluster('a', 's'), cluster('b', 's')), new Set(), new Map([['s', 'gone']]));
    expect(shownIds(folded)).toEqual(['a']);
  });

  test('an opened squad shows everyone, and still knows it is a squad', () => {
    // Act
    const opened = foldSquads(sceneOf(cluster('a', 's'), cluster('b', 's')), new Set(['s']), new Map());

    // Assert
    expect(shownIds(opened)).toEqual(['a', 'b']);
    expect(opened.rooms[0]?.clusters[1]?.squad).toMatchObject({ currentId: 'b', folded: false });
  });

  test('the last one left is just a terminal', () => {
    const folded = foldSquads(sceneOf(cluster('a', 's')), new Set(), new Map());
    expect(folded.rooms[0]?.clusters[0]?.squad).toBeUndefined();
  });

  test('two squads fold apart', () => {
    const folded = foldSquads(
      sceneOf(cluster('a', 's'), cluster('x', 't'), cluster('b', 's'), cluster('y', 't')),
      new Set(),
      new Map(),
    );
    expect(shownIds(folded)).toEqual(['a', 'x']);
  });
});
