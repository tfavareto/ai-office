import type { FurnitureItem, FurnitureKind } from '../../layout/types';
import { type Ctx, context2d, makeCanvas } from './ctx';
import * as office from './furnOffice';
import * as social from './furnSocial';
import * as plants from './plants';

type Draw = (ctx: Ctx, item: FurnitureItem) => void;

interface Painter {
  /** Pixels above the footprint that the sprite extends (monitors, tall plants...). */
  rise: number;
  draw: Draw;
}

const PAINTERS: Partial<Record<FurnitureKind, Painter>> = {
  desk: { rise: 10, draw: office.desk },
  chair: { rise: 8, draw: office.chair },
  shelf: { rise: 10, draw: office.shelf },
  copier: { rise: 2, draw: office.copier },
  bin: { rise: 0, draw: office.bin },
  plant: { rise: 4, draw: plants.plant },
  plantTall: { rise: 18, draw: plants.plantTall },
  lamp: { rise: 14, draw: office.lamp },
  sideTable: { rise: 2, draw: office.sideTable },
  bench: { rise: 4, draw: office.bench },
  waterCooler: { rise: 12, draw: office.waterCooler },
  receptionDesk: { rise: 7, draw: social.receptionDesk },
  sofa: { rise: 8, draw: social.sofa },
  coffeeTable: { rise: 0, draw: social.coffeeTable },
  counter: { rise: 6, draw: social.counter },
  coffeeMachine: { rise: 8, draw: social.coffeeMachine },
  fridge: { rise: 14, draw: social.fridge },
  vending: { rise: 14, draw: social.vending },
  highTable: { rise: 2, draw: social.highTable },
  stool: { rise: 0, draw: social.stool },
  roundTable: { rise: 2, draw: social.roundTable },
  cafeChair: { rise: 3, draw: social.cafeChair },
  meetingTable: { rise: 0, draw: social.meetingTable },
  meetChair: { rise: 4, draw: social.meetChair },
  stall: { rise: 10, draw: social.stall },
  sink: { rise: 4, draw: social.sink },
  pingpong: { rise: 2, draw: social.pingpong },
  arcade: { rise: 14, draw: social.arcade },
  beanbag: { rise: 0, draw: social.beanbag },
  bookshelf: { rise: 12, draw: social.bookshelf },
  deckChair: { rise: 3, draw: social.deckChair },
  deckTable: { rise: 0, draw: social.deckTable },
  railing: { rise: 0, draw: social.railing },
};

export interface FurnitureSprite {
  canvas: HTMLCanvasElement;
  /** Pixels above the footprint top-left that the canvas extends. */
  rise: number;
}

const sprites = new Map<string, FurnitureSprite>();

export function hasSprite(kind: FurnitureKind): boolean {
  return kind in PAINTERS;
}

export function spriteRise(kind: FurnitureKind): number {
  return PAINTERS[kind]?.rise ?? 0;
}

/** Cached sprite for an item (shared by every identical item in every room). */
export function furnitureSprite(item: FurnitureItem): FurnitureSprite | null {
  const painter = PAINTERS[item.kind];
  if (!painter) return null;
  const key = `${item.kind}|${item.variant}|${item.w}x${item.h}|${item.facing}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    const canvas = makeCanvas(item.w * 16, item.h * 16 + painter.rise);
    const ctx = context2d(canvas);
    ctx.translate(0, painter.rise);
    painter.draw(ctx, item);
    sprite = { canvas, rise: painter.rise };
    sprites.set(key, sprite);
  }
  return sprite;
}

export function clearSpriteCache(): void {
  sprites.clear();
}
