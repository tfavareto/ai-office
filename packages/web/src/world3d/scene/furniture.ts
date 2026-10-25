// Dispatches layout furniture items to their procedural / glTF builders.
import { Matrix4, Vector3 } from 'three';
import { isDrawn } from '../../layout/decor';
import type { AreaLayout, Dir, FurnitureItem, FurnitureKind } from '../../layout/types';
import { BASE_EVOLUTION, type Evolution } from '../../world/evolution';
import { TILE_M as T } from '../units';
import { PartCollector, transform } from '../util/parts';
import type { FurnCtx } from './furnitureContext';
import * as decor from './furnitureDecor';
import * as office from './furnitureOffice';
import * as social from './furnitureSocial';
import type { Materials } from './materials';
import type { Models } from './models';

export interface ScreenQuad {
  desk: number;
  slot: number;
  matrix: Matrix4;
  w: number;
  h: number;
}

export interface GlowPoint {
  position: Vector3;
  warm: boolean;
}

export interface FurnitureOutput {
  screens: ScreenQuad[];
  glows: GlowPoint[];
}

const YAW: Record<Dir, number> = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };

type Builder = (f: FurnCtx) => void;

const BUILDERS: Partial<Record<FurnitureKind, Builder>> = {
  desk: office.buildDesk,
  chair: office.buildChair,
  shelf: office.buildShelf,
  copier: office.buildCopier,
  bin: office.buildBin,
  plant: (f) => office.buildPlant(f, false),
  plantTall: (f) => office.buildPlant(f, true),
  rug: office.buildRug,
  lamp: office.buildLamp,
  bench: office.buildBench,
  waterCooler: office.buildCooler,
  sideTable: office.buildSideTable,
  receptionDesk: office.buildReceptionDesk,
  sofa: office.buildSofa,
  armchair: office.buildArmchair,
  coffeeTable: office.buildCoffeeTable,
  counter: social.buildCounter,
  coffeeMachine: social.buildCoffeeMachine,
  fridge: social.buildFridge,
  vending: social.buildVending,
  highTable: social.buildHighTable,
  stool: social.buildStool,
  roundTable: social.buildRoundTable,
  cafeChair: social.buildCafeChair,
  meetingTable: office.buildMeetingTable,
  meetChair: office.buildMeetChair,
  stall: social.buildStall,
  sink: social.buildSink,
  pingpong: social.buildPingPong,
  arcade: social.buildArcade,
  beanbag: social.buildBeanbag,
  bookshelf: social.buildBookshelf,
  deckChair: social.buildDeckChair,
  deckTable: social.buildDeckTable,
  railing: social.buildRailing,
  aquarium: decor.buildAquarium,
  trophyCabinet: decor.buildTrophyCabinet,
  lights: decor.buildLights,
  // the plaque is a picture on the desk (decorScreens.ts)
  plaque: () => undefined,
};

/** Rooms' second-row fixtures face the room centre instead of south. */
function facingOf(item: FurnitureItem, area: AreaLayout): Dir {
  if ((item.kind === 'stall' || item.kind === 'sink') && item.y > area.floor.y + area.floor.h / 2) return 'n';
  return item.facing;
}

export function buildFurniture(
  c: PartCollector,
  area: AreaLayout,
  m: Materials,
  models: Models,
  evolution: Evolution = BASE_EVOLUTION,
): FurnitureOutput {
  const out: FurnitureOutput = { screens: [], glows: [] };
  for (const item of area.furniture) {
    if (!isDrawn(item, evolution.decor)) continue;
    // the extra arcade machines of the lounge have their own colours
    const builder = item.kind === 'arcade' && item.decor !== undefined ? decor.buildDecorArcade : BUILDERS[item.kind];
    const facing = facingOf(item, area);
    const sideways = facing === 'e' || facing === 'w';
    const cx = (item.x + item.w / 2) * T;
    const cz = (item.y + item.h / 2) * T;
    const toWorld = transform(cx, 0, cz, YAW[facing]);
    const local = new PartCollector();
    const ctx: FurnCtx = {
      c: local,
      m,
      models,
      item,
      area,
      evolution,
      w: (sideways ? item.h : item.w) * T,
      d: (sideways ? item.w : item.h) * T,
      toWorld,
      screen: (desk, slot, matrix, w, h) =>
        out.screens.push({ desk, slot, matrix: new Matrix4().multiplyMatrices(toWorld, matrix), w, h }),
      light: (x, y, z, warm) => out.glows.push({ position: new Vector3(x, y, z).applyMatrix4(toWorld), warm }),
    };
    if (builder) builder(ctx);
    else local.boxOn(m.graphite, 0, 0, 0, ctx.w * 0.9, 0.6, ctx.d * 0.9);
    c.addAll(local, toWorld);
  }
  return out;
}
