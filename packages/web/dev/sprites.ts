// Dev gallery: every pose and direction of a few looks, for reviewing the procedural pixel people.
import { characterFrame } from '../src/world2d/chars/cache';
import { lookFor } from '../src/world2d/chars/looks';
import { SPRITE_H, SPRITE_W, poseFrames } from '../src/world2d/chars/sprites';
import type { Pose } from '../src/sim/types';

const ALL_POSES: Pose[] = ['stand', 'walk', 'sit', 'type', 'hand', 'coffee', 'celebrate', 'sleep', 'lean', 'stretch', 'popcorn', 'talk', 'listen', 'play', 'arcade', 'read', 'wash'];
const DIRS = ['s', 'n', 'e', 'w'] as const;
const params = new URLSearchParams(location.search);
const POSES: Pose[] = params.get('poses') ? (params.get('poses')!.split(',') as Pose[]) : ALL_POSES;
const seeds = (params.get('seeds') ?? '1,2,3,4').split(',').map(Number);
const SCALE = Number(params.get('scale') ?? 3);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const cellW = SPRITE_W * SCALE + 4;
const cellH = SPRITE_H * SCALE + 4;
const MAX_FRAMES = Number(params.get('frames') ?? 4);
const perRow = 4 * MAX_FRAMES;
const rows = POSES.length;
canvas.width = cellW * perRow * Math.ceil(seeds.length / 2) + 80;
canvas.height = cellH * rows * 2 + 20;
ctx.imageSmoothingEnabled = false;
ctx.font = '11px monospace';
POSES.forEach((pose, r) => {
  ctx.fillStyle = '#cfd6e4';
  ctx.fillText(pose, 4, r * cellH + 40);
});
seeds.forEach((seed, si) => {
  const look = lookFor(seed * 7717, seed % 2 === 0 ? 'f' : 'm', seed === 3);
  const ox = 80 + Math.floor(si / 2) * cellW * perRow;
  const oy = (si % 2) * cellH * rows;
  POSES.forEach((pose, r) => {
    DIRS.forEach((dir, d) => {
      const frames = Math.min(MAX_FRAMES, poseFrames(pose));
      for (let f = 0; f < frames; f++) {
        const x = ox + (d * MAX_FRAMES + f) * cellW;
        const y = oy + r * cellH;
        ctx.fillStyle = (d + r) % 2 ? '#4a505c' : '#434955';
        ctx.fillRect(x, y, cellW - 2, cellH - 2);
        ctx.drawImage(characterFrame(look, pose, dir, f), x, y, SPRITE_W * SCALE, SPRITE_H * SCALE);
      }
    });
  });
});
