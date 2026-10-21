import { AreaBuilder } from './builder';
import { hslToHex } from './color';
import { ROOM_W } from './constants';
import { Rng } from './rng';
import { slotPosition } from './slots';
import type { AreaLayout, AreaTheme, RoomSpec } from './types';

/** Floor column of the aisle that connects the door with every workstation. */
export const AISLE_FX = 4;

export function projectTheme(seed: number): AreaTheme {
  const rng = new Rng(seed ^ 0x51ed270b);
  const hue = (seed >>> 3) % 360;
  return {
    floor: 'carpet',
    hue,
    accent: hslToHex(hue, 0.62 + rng.range(-0.06, 0.08), 0.56),
    carpet: hslToHex(hue + rng.range(-10, 10), 0.09 + rng.range(0, 0.05), 0.32),
    carpetAlt: hslToHex(hue + rng.range(-10, 10), 0.09 + rng.range(0, 0.05), 0.28),
    pattern: rng.int(4),
    wood: rng.int(3),
  };
}

interface Bay {
  fx: number;
  fy: number;
}

/** Free bays on the bottom row (between the corner plants and the aisle) where decoration may stand. */
const DECOR_BAYS: readonly Bay[] = [
  { fx: 1, fy: 8 },
  { fx: 5, fy: 8 },
];

type DecorFn = (b: AreaBuilder, bay: Bay, rng: Rng) => void;

const DECOR: readonly DecorFn[] = [
  (b, bay) => {
    b.put('shelf', bay.fx, bay.fy, 2, 1);
    b.put('plant', bay.fx + 2, bay.fy, 1, 1, { variant: 0 });
  },
  (b, bay) => {
    b.put('copier', bay.fx, bay.fy, 1, 1);
    b.put('bin', bay.fx + 2, bay.fy, 1, 1);
  },
  (b, bay, rng) => {
    b.put('plant', bay.fx, bay.fy, 1, 1, { variant: rng.int(4) });
    b.put('plant', bay.fx + 2, bay.fy, 1, 1, { variant: rng.int(4) });
  },
  (b, bay) => {
    b.put('sideTable', bay.fx, bay.fy, 1, 1);
    b.put('lamp', bay.fx + 1, bay.fy, 1, 1);
  },
  (b, bay) => {
    b.put('shelf', bay.fx + 1, bay.fy, 2, 1, { variant: 1 });
  },
];

/** A project room: 6 workstations around a central aisle, deterministic variations from the project seed. */
export function layoutProjectRoom(spec: RoomSpec): AreaLayout {
  const slot = slotPosition(spec.slot);
  const b = new AreaBuilder({
    id: spec.areaId ?? `room:${spec.id}`,
    kind: 'project',
    label: spec.name,
    row: slot.row,
    x: slot.x,
    width: ROOM_W,
    theme: projectTheme(spec.seed),
    projectId: spec.id,
    slot: spec.slot,
  });
  const rng = new Rng(spec.seed ^ 0x9e3779b9);
  const northRow = slot.row === 'north';

  b.wallItem('sign', 0, 3);
  if (northRow) {
    b.wallItem('board', 3, 3);
    b.wallItem(rng.chance(0.5) ? 'clock' : 'poster', 7, 2, rng.int(3));
  } else {
    b.wallItem('board', 5, 3);
    b.wallItem(rng.chance(0.5) ? 'clock' : 'poster', 3, 1, rng.int(3));
  }

  b.put('rug', 0, 0, 9, 9, { variant: rng.int(3), walk: true });
  for (let i = 0; i < 6; i++) {
    const row = i >> 1;
    const left = (i & 1) === 0;
    const deskFx = left ? 0 : 5;
    const fy = row * 3;
    b.put('desk', deskFx, fy, 4, 1, { variant: i });
    b.put('chair', deskFx + 1, fy + 1, 2, 1, { facing: 'n', variant: rng.int(3) });
    b.spot('desk', deskFx + 2, fy + 1.55, 'n', {
      seat: true,
      approach: { x: left ? 3 : 5, y: fy + 1 },
      deskIndex: i,
    });
  }

  const bays = [...DECOR_BAYS];
  for (let i = bays.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [bays[i], bays[j]] = [bays[j], bays[i]];
  }
  bays.forEach((bay) => {
    if (rng.chance(0.85)) DECOR[rng.int(DECOR.length)](b, bay, rng);
  });

  b.put('plantTall', 0, 8, 1, 1, { variant: rng.int(2) });
  b.put('plantTall', 8, 8, 1, 1, { variant: rng.int(2) });
  b.spot('overflow', 1.5, 5.55, 'n', { approach: { x: 1, y: 5 } });
  b.spot('overflow', 2.5, 5.55, 'n', { approach: { x: 2, y: 5 } });
  b.spot('overflow', 6.5, 5.55, 'n', { approach: { x: 6, y: 5 } });
  b.spot('overflow', 7.5, 5.55, 'n', { approach: { x: 7, y: 5 } });
  b.door(AISLE_FX, 1, 'door');
  return b.build();
}
