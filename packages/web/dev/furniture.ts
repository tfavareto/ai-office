// Dev gallery: plants (every variant) and workstations (every monitor state) at a large scale, on a project-room carpet.
// Query: ?scale=6&kinds=plant,plantTall,desk
import { TILE } from '../src/layout/constants';
import { projectTheme } from '../src/layout/project';
import type { FurnitureItem, FurnitureKind } from '../src/layout/types';
import { deskScreenRects } from '../src/world2d/paint/deskLayout';
import { furnitureSprite } from '../src/world2d/paint/furniture';
import { paintFloorTile } from '../src/world2d/paint/floors';
import { type ScreenKind, SCREEN_H, SCREEN_W, screenSprite } from '../src/world2d/runtime/screens';

const params = new URLSearchParams(location.search);
const SCALE = Number(params.get('scale') ?? 6);
const kinds = (params.get('kinds') ?? 'plant,plantTall,desk').split(',');
const theme = projectTheme(31337);

function item(kind: FurnitureKind, variant: number, w: number, x = 0, y = 0): FurnitureItem {
  return { id: `${kind}${variant}`, kind, x, y, w, h: 1, variant, facing: 'n', rotation: 0, blocks: [], tall: false };
}

const DESK_STATES: ScreenKind[][] = [['off', 'off'], ['code', 'term'], ['code', 'read'], ['code', 'web'], ['code', 'wait'], ['idle', 'standby']];
const ROWS: { label: string; items: FurnitureItem[] }[] = [];
if (kinds.includes('plant')) ROWS.push({ label: 'plant 0-3', items: [0, 1, 2, 3].map((v) => item('plant', v, 1)) });
if (kinds.includes('plantTall')) ROWS.push({ label: 'plantTall 0-1', items: [0, 1].map((v) => item('plantTall', v, 1)) });
if (kinds.includes('desk')) ROWS.push({ label: 'desk states', items: DESK_STATES.map((_, v) => item('desk', v, 4)) });

const PAD = 2;
const cols = Math.max(...ROWS.map((r) => r.items.reduce((sum, it) => sum + it.w + PAD, 0)));
const rowH = 3;
const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = cols * TILE * SCALE;
canvas.height = ROWS.length * rowH * TILE * SCALE;
const out = canvas.getContext('2d')!;
out.imageSmoothingEnabled = false;

ROWS.forEach((row, r) => {
  const stage = document.createElement('canvas');
  stage.width = cols * TILE;
  stage.height = rowH * TILE;
  const ctx = stage.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let ty = 0; ty < rowH; ty++) for (let tx = 0; tx < cols; tx++) paintFloorTile(ctx, theme, tx, ty, tx * TILE, ty * TILE, 'gallery');
  let tx = 1;
  row.items.forEach((it, i) => {
    const placed = { ...it, x: tx, y: 1 };
    const sprite = furnitureSprite(placed);
    if (!sprite) return;
    ctx.fillStyle = 'rgba(8,10,18,0.20)';
    ctx.fillRect(tx * TILE + 1, TILE + 3, it.w * TILE + 1, TILE - 1);
    ctx.drawImage(sprite.canvas, tx * TILE, TILE - sprite.rise);
    if (it.kind === 'desk') {
      const chair = furnitureSprite({ ...item('chair', 0, 2), x: tx + 1, y: 2 });
      if (chair) ctx.drawImage(chair.canvas, (tx + 1) * TILE, 2 * TILE - chair.rise);
      const kindsOf = DESK_STATES[i];
      deskScreenRects().forEach((rect, k) => ctx.drawImage(screenSprite(kindsOf[k], 0), tx * TILE + rect.x, TILE + rect.y, SCREEN_W, SCREEN_H));
    }
    tx += it.w + PAD;
  });
  out.drawImage(stage, 0, r * rowH * TILE * SCALE, stage.width * SCALE, stage.height * SCALE);
});
