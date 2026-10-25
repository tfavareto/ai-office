// Small helpers of the simulation's social side that need no simulation state: shell stages, the stretch at a desk,
// where two people meet and the wave of two people crossing.
import type { Agent } from '@ai-office/shared';
import { isWalkable, nearestWalkable } from '../layout/grid';
import type { Grid, TilePos } from '../layout/types';
import { type Actor, dirFromVector } from './actor';
import type { Liveliness } from './bubbles';
import { WAVE_SECONDS } from './encounters';

/** Shell wait stages: lean back, stretch (1 min), popcorn (3 min), nap (8 min). */
const SHELL_STAGE_SECONDS = [0, 60, 180, 480];
export const SHELL_STAGE_POSES = ['lean', 'stretch', 'popcorn', 'sleep'] as const;

export function hasForegroundShell(agent: Agent): boolean {
  return agent.shells.some((s) => !s.background && s.kind === 'shell');
}

/** 0-3: how long the foreground shell command has been running. */
export function shellStage(agent: Agent, serverNow: number): number {
  const started = agent.shells.filter((s) => !s.background && s.kind === 'shell').map((s) => s.startedAt);
  if (started.length === 0) return 0;
  const elapsed = (serverNow - Math.min(...started)) / 1000;
  let stage = 0;
  SHELL_STAGE_SECONDS.forEach((threshold, i) => {
    if (elapsed >= threshold) stage = i;
  });
  return stage;
}

const STRETCH_SPACING: Record<Liveliness, number> = { calm: 2.2, normal: 1, lively: 0.7 };
const STRETCH_SECONDS = 2.8;

/** Every now and then somebody idle at the desk stretches (and yawns): schedules the next one. */
export function scheduleStretch(a: Actor, now: number, liveliness: Liveliness): void {
  if (a.microDue === 0) a.microDue = now + a.rng.range(25, 70);
  if (now < a.microDue) return;
  a.microUntil = now + STRETCH_SECONDS;
  a.microDue = now + a.rng.range(45, 100) * STRETCH_SPACING[liveliness];
}

const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Two adjacent walkable tiles around a point, where two people can meet face to face. */
export function meetingTiles(grid: Grid, x: number, y: number): readonly [TilePos, TilePos] | null {
  const middle = nearestWalkable(grid, { x: Math.floor(x), y: Math.floor(y) }, 6);
  if (!middle) return null;
  for (const [dx, dy] of SIDES) {
    const other = { x: middle.x + dx, y: middle.y + dy };
    if (isWalkable(grid, other.x, other.y)) return [middle, other];
  }
  return null;
}

/** Two people crossing stop for a moment, face each other and wave. */
export function startWave(a: Actor, b: Actor, now: number): void {
  for (const [me, you] of [
    [a, b],
    [b, a],
  ] as const) {
    me.pauseUntil = now + WAVE_SECONDS;
    me.pausePose = 'wave';
    me.dir = dirFromVector(you.x - me.x, you.y - me.y, me.dir);
  }
}
