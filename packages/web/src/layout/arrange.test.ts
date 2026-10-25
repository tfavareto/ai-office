import { describe, expect, it } from 'vitest';
import type { Agent, OfficeSnapshot, Project } from '@ai-office/shared';
import {
  arrangeRooms,
  arrangeSnapshot,
  draftFromRooms,
  draftOrder,
  layoutPatch,
  moveBy,
  moveItem,
  sidebarOrder,
  type RoomRef,
} from './arrange';

const room = (id: string, order: number, extra: Partial<RoomRef> = {}): RoomRef => ({ id, order, ...extra });

describe('arrangeRooms', () => {
  it('keeps the order of arrival when nothing was chosen', () => {
    const result = arrangeRooms([room('c', 2), room('a', 0), room('b', 1)]);
    expect(result).toEqual({ slots: ['a', 'b', 'c'], hidden: [], custom: false });
  });

  it('puts pinned rooms first, in their own order', () => {
    const result = arrangeRooms([
      room('a', 0),
      room('b', 1, { pinned: true }),
      room('c', 2, { pinned: true, rank: 0 }),
    ]);
    expect(result.slots).toEqual(['c', 'b', 'a']);
    expect(result.custom).toBe(true);
  });

  it('follows the rank the person set, with unplaced rooms after the placed ones', () => {
    const result = arrangeRooms([
      room('a', 0, { rank: 2 }),
      room('b', 1, { rank: 0 }),
      room('c', 2),
      room('d', 3, { rank: 1 }),
      room('e', 4),
    ]);
    expect(result.slots).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('takes hidden rooms out of the slots and lists them by arrival', () => {
    const result = arrangeRooms([
      room('a', 0, { hidden: true }),
      room('b', 1),
      room('c', 2, { hidden: true, pinned: true }),
    ]);
    expect(result).toEqual({ slots: ['b'], hidden: ['a', 'c'], custom: false });
  });

  it('is custom as soon as a visible room is pinned or ranked', () => {
    expect(arrangeRooms([room('a', 0, { rank: 0 })]).custom).toBe(true);
    expect(arrangeRooms([room('a', 0, { rank: 0, hidden: true })]).custom).toBe(false);
  });

  it('breaks ties by id so the result never depends on the input order', () => {
    const rooms = [room('b', 0), room('a', 0)];
    expect(arrangeRooms(rooms).slots).toEqual(['a', 'b']);
    expect(arrangeRooms([...rooms].reverse()).slots).toEqual(['a', 'b']);
  });

  it('does not change its input', () => {
    const rooms = [room('b', 1), room('a', 0)];
    arrangeRooms(rooms);
    expect(rooms.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('sidebarOrder', () => {
  it('lists the shown rooms and then the hidden ones', () => {
    expect(sidebarOrder([room('a', 0, { hidden: true }), room('b', 1), room('c', 2, { pinned: true })])).toEqual([
      'c',
      'b',
      'a',
    ]);
  });
});

function snapshot(projects: Project[], agents: Partial<Agent>[]): OfficeSnapshot {
  return {
    rev: 1,
    serverTime: 0,
    meta: { version: '', startedAt: 0, local: true, demo: false },
    accounts: [],
    projects,
    agents: agents as Agent[],
    usage: [],
    hires: [
      { id: 'h1', projectId: 'a', accountId: 'x', createdAt: 0, expiresAt: 1 },
      { id: 'h2', projectId: 'b', accountId: 'x', createdAt: 0, expiresAt: 1 },
    ],
  };
}
const project = (id: string, order: number, extra: Partial<Project> = {}): Project => ({
  id,
  name: id,
  path: id,
  seed: order,
  order,
  ...extra,
});

describe('arrangeSnapshot', () => {
  it('returns the very same snapshot when nothing was chosen', () => {
    const input = snapshot([project('a', 0), project('b', 1)], [{ id: '1', projectId: 'a' }]);
    expect(arrangeSnapshot(input)).toBe(input);
  });

  it('renumbers the order into slots and drops hidden rooms with their people and hires', () => {
    const input = snapshot(
      [project('a', 0, { hidden: true }), project('b', 1), project('c', 2, { pinned: true })],
      [
        { id: '1', projectId: 'a' },
        { id: '2', projectId: 'b' },
        { id: '3', projectId: 'c' },
      ],
    );
    const out = arrangeSnapshot(input);
    expect(out.projects.map((p) => [p.id, p.order])).toEqual([
      ['c', 0],
      ['b', 1],
    ]);
    expect(out.agents.map((a) => a.id)).toEqual(['2', '3']);
    expect(out.hires?.map((h) => h.id)).toEqual(['h2']);
    expect(input.projects[0]?.order).toBe(0);
  });

  it('leaves the hires out when none of them is for a shown room', () => {
    const input = snapshot([project('a', 0, { hidden: true }), project('b', 1, { hidden: true }), project('c', 2)], []);
    expect(arrangeSnapshot(input).hires).toBeUndefined();
  });
});

describe('moving rooms', () => {
  it('moves an item to a place, clamped to the list', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b'], 0, 9)).toEqual(['b', 'a']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('moves an item one step and stops at the ends', () => {
    expect(moveBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'z', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('the layout editor draft', () => {
  const rooms = [room('a', 0), room('b', 1, { pinned: true }), room('c', 2, { hidden: true }), room('d', 3)];

  it('starts from the arrangement the building has now', () => {
    const draft = draftFromRooms(rooms);
    expect(draft.ids).toEqual(['b', 'a', 'd', 'c']);
    expect([...draft.pinned]).toEqual(['b']);
    expect([...draft.hidden]).toEqual(['c']);
  });

  it('orders pinned rooms first and hidden ones last, whatever the list says', () => {
    expect(draftOrder({ ids: ['a', 'c', 'b', 'd'], pinned: new Set(['d']), hidden: new Set(['c']) })).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
  });

  it('builds the patch of what changed, and nothing for rooms left alone', () => {
    const draft = { ids: ['a', 'b', 'd', 'c'], pinned: new Set(['b', 'd']), hidden: new Set<string>() };
    expect(layoutPatch(rooms, draft)).toEqual({
      order: ['b', 'd', 'a', 'c'],
      rooms: { d: { pinned: true, hidden: null }, c: { pinned: null, hidden: null } },
    });
  });

  it('keeps the place of rooms that are not in the office now', () => {
    const draft = draftFromRooms(rooms);
    expect(layoutPatch(rooms, draft, ['gone', 'a', 'b']).order).toEqual(['b', 'a', 'd', 'c', 'gone']);
  });

  it('the patch applied to the rooms gives the arrangement of the draft', () => {
    const draft = { ids: ['d', 'a', 'b', 'c'], pinned: new Set(['b']), hidden: new Set(['a']) };
    const patch = layoutPatch(rooms, draft);
    const placed = rooms.map((r) => {
      const flags = patch.rooms[r.id];
      return {
        ...r,
        rank: patch.order.indexOf(r.id),
        pinned: flags !== undefined ? flags.pinned === true : r.pinned,
        hidden: flags !== undefined ? flags.hidden === true : r.hidden,
      };
    });
    expect(arrangeRooms(placed)).toMatchObject({ slots: ['b', 'd', 'c'], hidden: ['a'] });
  });
});
