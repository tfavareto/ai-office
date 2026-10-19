import type { AreaKind } from '../../layout/types';
import type { WorldKey } from './pt-BR';

const AREA_KEYS: Readonly<Partial<Record<AreaKind, WorldKey>>> = {
  reception: 'area.reception',
  copa: 'area.copa',
  meeting: 'area.meeting',
  bathrooms: 'area.bathrooms',
  lounge: 'area.lounge',
};

/** Catalog key of a common area's name; project rooms have none (they carry the project name). */
export function areaNameKey(kind: AreaKind): WorldKey | null {
  return AREA_KEYS[kind] ?? null;
}

/** Displayed name of an area: its translated name, or the layout label (the project name) for project rooms. */
export function areaLabel(area: { kind: AreaKind; label: string }, text: { t(key: WorldKey): string }): string {
  const key = areaNameKey(area.kind);
  return key ? text.t(key) : area.label;
}
