// The ping-pong ball: where it is on a table, given the time. Pure, so both renderers show the same rally.
import type { Spot } from '../layout/types';
import type { SpotBook } from './spots';
import type { Actor } from './actor';

export interface PingPongTable {
  /** Feet position (tile units) of the two players. */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Both players are in the middle of a rally. */
  playing: boolean;
  /** Stable per table (variation of the rally rhythm). */
  seed: number;
}

export interface Ball {
  /** Tile units on the floor plan. */
  x: number;
  y: number;
  /** Height above the table in tiles. */
  z: number;
}

/** Seconds for the ball to cross the table once. */
const FLIGHT = 0.55;
const ARC = 0.55;
/** The ball bounces off the paddles slightly in front of the players. */
const REACH = 0.7;

/** The spot pairs of every ping-pong table, found once per layout (the spot list is replaced when it changes). */
const pairsCache = new WeakMap<readonly Spot[], { group: string; a: Spot; b: Spot }[]>();

function pairsOf(all: readonly Spot[]): { group: string; a: Spot; b: Spot }[] {
  const hit = pairsCache.get(all);
  if (hit) return hit;
  const groups = new Map<string, Spot[]>();
  for (const s of all) {
    if (s.kind !== 'pingpong' || !s.group) continue;
    groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
  }
  const pairs: { group: string; a: Spot; b: Spot }[] = [];
  for (const [group, list] of groups) {
    const [a, b] = list;
    if (a && b) pairs.push({ group, a, b });
  }
  pairsCache.set(all, pairs);
  return pairs;
}

export function pingPongTables(spots: SpotBook, actor: (id: string) => Actor | undefined): PingPongTable[] {
  return pairsOf(spots.all()).map(({ group, a, b }) => {
    const players = [a, b].map((spot) => {
      const owner = spots.claimant(spot.id);
      return owner === undefined ? undefined : actor(owner);
    });
    const playing = players.every((p) => p !== undefined && p.phase === 'doing' && p.pose === 'play');
    return { ax: a.x, ay: a.y, bx: b.x, by: b.y, playing, seed: group.length };
  });
}

/** Position of the ball at time `t` (seconds). While nobody plays it rests on the table. */
export function ballAt(table: PingPongTable, t: number): Ball {
  const midX = (table.ax + table.bx) / 2;
  const midY = (table.ay + table.by) / 2;
  if (!table.playing) return { x: midX + 1.1, y: midY - 0.05, z: 0 };
  const phase = (t / FLIGHT + table.seed * 0.37) % 2;
  const leg = phase < 1 ? phase : 2 - phase;
  const startX = table.ax + REACH;
  const endX = table.bx - REACH;
  const x = startX + (endX - startX) * leg;
  const y = midY + Math.sin((phase < 1 ? phase : 1 - (phase - 1)) * Math.PI * 2) * 0.04;
  const arc = Math.sin(Math.min(1, phase % 1) * Math.PI);
  return { x, y, z: arc * ARC };
}
