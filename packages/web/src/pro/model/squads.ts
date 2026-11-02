// Squads: saved groups of roles started together, and how the canvas shows them. A squad's terminals are one block: the
// member in view takes the place of the first, the others are listed on its title bar. Selecting a member brings it into
// view, so going to an agent always works. Pure.
import { SQUAD_MAX_MEMBERS, SQUAD_MIN_MEMBERS, type HireRole } from '@ai-office/shared';
import { validRole } from './roles';
import type { Scene, SceneCluster } from './scene';

export interface SavedSquad {
  id: string;
  name: string;
  members: readonly HireRole[];
}

export const MAX_SQUADS = 20;
export const SQUAD_NAME_MAX = 48;

export function validSquad(name: string, members: readonly HireRole[]): boolean {
  const clean = name.trim();
  return (
    clean.length > 0 &&
    clean.length <= SQUAD_NAME_MAX &&
    members.length >= SQUAD_MIN_MEMBERS &&
    members.length <= SQUAD_MAX_MEMBERS &&
    members.every((member) => validRole(member.name, member.instructions))
  );
}

/** Adds a squad; one with the same name is replaced, so editing is saving again under that name. */
export function addSquad(list: readonly SavedSquad[], squad: SavedSquad): SavedSquad[] {
  const name = squad.name.trim();
  const others = list.filter((entry) => entry.name.trim().toLowerCase() !== name.toLowerCase());
  return [{ ...squad, name }, ...others].slice(0, MAX_SQUADS);
}

export function removeSquad(list: readonly SavedSquad[], id: string): SavedSquad[] {
  return list.filter((entry) => entry.id !== id);
}

export function parseSquads(raw: unknown): SavedSquad[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SQUADS).flatMap((entry: unknown): SavedSquad[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { id, name, members } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || !Array.isArray(members)) return [];
    const roles = members.flatMap((member: unknown): HireRole[] => {
      if (typeof member !== 'object' || member === null) return [];
      const { name: role, instructions } = member as Record<string, unknown>;
      return typeof role === 'string' && typeof instructions === 'string' ? [{ name: role, instructions }] : [];
    });
    return validSquad(name, roles) ? [{ id, name, members: roles }] : [];
  });
}

function foldRoom(
  clusters: readonly SceneCluster[],
  opened: ReadonlySet<string>,
  current: ReadonlyMap<string, string>,
): SceneCluster[] {
  const groups = new Map<string, SceneCluster[]>();
  for (const cluster of clusters) {
    const id = cluster.main.terminalSquad;
    if (id !== undefined) groups.set(id, [...(groups.get(id) ?? []), cluster]);
  }
  return clusters.flatMap((cluster): SceneCluster[] => {
    const id = cluster.main.terminalSquad;
    const group = id === undefined ? undefined : groups.get(id);
    // The last one left is just a terminal.
    if (id === undefined || group === undefined || group.length < SQUAD_MIN_MEMBERS) return [cluster];
    const members = group.map((member) => member.main);
    if (opened.has(id)) return [{ ...cluster, squad: { id, members, currentId: cluster.main.id, folded: false } }];
    if (cluster !== group[0]) return [];
    const shown = group.find((member) => member.main.id === current.get(id)) ?? cluster;
    return [{ ...shown, squad: { id, members, currentId: shown.main.id, folded: true } }];
  });
}

export function foldSquads(scene: Scene, opened: ReadonlySet<string>, current: ReadonlyMap<string, string>): Scene {
  return {
    ...scene,
    rooms: scene.rooms.map((room) => ({ ...room, clusters: foldRoom(room.clusters, opened, current) })),
  };
}
