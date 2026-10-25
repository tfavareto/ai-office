// How the person's choices arrange the rooms of the building: pinned rooms first, then the order they set by hand,
// then the rooms they never placed in order of arrival; hidden rooms leave the building. Pure and deterministic.
import type { OfficeSnapshot } from '@ai-office/shared';

/** What the arrangement needs to know about a room (a subset of `Project`). */
export interface RoomRef {
  id: string;
  /** Order of arrival. */
  order: number;
  /** Position in the order the person arranged, when the room was placed there. */
  rank?: number | undefined;
  pinned?: boolean | undefined;
  hidden?: boolean | undefined;
}

export interface Arrangement {
  /** Room ids in slot order: slot 0 first. Hidden rooms are not here. */
  slots: string[];
  /** Hidden room ids, in order of arrival. */
  hidden: string[];
  /** The person arranged something (pinned or ordered a room): slots follow `slots` exactly. */
  custom: boolean;
}

function compareRooms(a: RoomRef, b: RoomRef): number {
  const pinned = Number(b.pinned === true) - Number(a.pinned === true);
  if (pinned !== 0) return pinned;
  const aRanked = a.rank !== undefined;
  const bRanked = b.rank !== undefined;
  if (aRanked !== bRanked) return aRanked ? -1 : 1;
  if (aRanked && bRanked && a.rank !== b.rank) return (a.rank as number) - (b.rank as number);
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function arrangeRooms(rooms: readonly RoomRef[]): Arrangement {
  const shown = rooms.filter((room) => room.hidden !== true).sort(compareRooms);
  const hidden = rooms
    .filter((room) => room.hidden === true)
    .sort((a, b) => a.order - b.order)
    .map((room) => room.id);
  return {
    slots: shown.map((room) => room.id),
    hidden,
    custom: shown.some((room) => room.pinned === true || room.rank !== undefined),
  };
}

/** The same arrangement for a list of projects (their ids in sidebar order: shown rooms, then hidden ones). */
export function sidebarOrder(rooms: readonly RoomRef[]): string[] {
  const { slots, hidden } = arrangeRooms(rooms);
  return [...slots, ...hidden];
}

/**
 * The snapshot the worlds draw: hidden rooms and the people in them are gone, and `order` is the slot of each room.
 * Without any choice the snapshot itself is returned.
 */
export function arrangeSnapshot(snapshot: OfficeSnapshot): OfficeSnapshot {
  const arrangement = arrangeRooms(snapshot.projects);
  if (!arrangement.custom && arrangement.hidden.length === 0) return snapshot;
  const slotOf = new Map(arrangement.slots.map((id, index) => [id, index]));
  const projects = snapshot.projects
    .filter((project) => slotOf.has(project.id))
    .map((project) => ({ ...project, order: slotOf.get(project.id) as number }))
    .sort((a, b) => a.order - b.order);
  const { hires: allHires, ...rest } = snapshot;
  const hires = allHires?.filter((hire) => slotOf.has(hire.projectId)) ?? [];
  return {
    ...rest,
    projects,
    agents: snapshot.agents.filter((agent) => slotOf.has(agent.projectId)),
    ...(hires.length > 0 ? { hires } : {}),
  };
}

// ---- editing ---------------------------------------------------------------------------------------------------------

/** `ids` with the item at `from` moved to `to` (both clamped to the list). */
export function moveItem<T>(ids: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= ids.length) return [...ids];
  const target = Math.min(Math.max(to, 0), ids.length - 1);
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Moves an id one step up (-1) or down (+1). */
export function moveBy<T>(ids: readonly T[], item: T, delta: -1 | 1): T[] {
  const index = ids.indexOf(item);
  return index < 0 ? [...ids] : moveItem(ids, index, index + delta);
}

export interface LayoutDraft {
  /** Room ids in the order the editor shows them (shown rooms first). */
  ids: readonly string[];
  pinned: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
}

/** The draft as the editor starts from it: the arrangement of the rooms the snapshot has. */
export function draftFromRooms(rooms: readonly (RoomRef & { id: string })[]): LayoutDraft {
  return {
    ids: sidebarOrder(rooms),
    pinned: new Set(rooms.filter((room) => room.pinned === true).map((room) => room.id)),
    hidden: new Set(rooms.filter((room) => room.hidden === true).map((room) => room.id)),
  };
}

/** The ids of the draft in the order the building will have them: pinned first, hidden ones last. */
export function draftOrder(draft: LayoutDraft): string[] {
  const rank = new Map(draft.ids.map((id, index) => [id, index]));
  const refs: RoomRef[] = draft.ids.map((id) => ({
    id,
    order: rank.get(id) as number,
    rank: rank.get(id) as number,
    pinned: draft.pinned.has(id),
    hidden: draft.hidden.has(id),
  }));
  return sidebarOrder(refs);
}

/**
 * The merge patch (for `PATCH /api/customization`) that takes the rooms from `rooms` to the draft. Rooms that are not
 * in the office now but were placed before (`storedOrder`) keep their relative place, after the ones in the draft.
 */
export function layoutPatch(
  rooms: readonly RoomRef[],
  draft: LayoutDraft,
  storedOrder: readonly string[] = [],
): { order: string[]; rooms: Record<string, { pinned: true | null; hidden: true | null }> } {
  const flags: Record<string, { pinned: true | null; hidden: true | null }> = {};
  const before = new Map(rooms.map((room) => [room.id, room]));
  for (const id of draft.ids) {
    const pinned = draft.pinned.has(id);
    const hidden = draft.hidden.has(id);
    const was = before.get(id);
    if (pinned === (was?.pinned === true) && hidden === (was?.hidden === true)) continue;
    flags[id] = { pinned: pinned ? true : null, hidden: hidden ? true : null };
  }
  const known = new Set(draft.ids);
  const away = storedOrder.filter((id) => !known.has(id));
  return { order: [...draftOrder(draft), ...away], rooms: flags };
}
