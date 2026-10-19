import { makeCanvas } from '../paint/ctx';
import { characterFrame } from './cache';
import type { Look } from './looks';

const cache = new Map<string, string>();

/** Head-and-torso crop of the character (front view, standing), scaled with nearest-neighbour. Cached data URL. */
export function portraitDataUrl(look: Look, size: number): string {
  const key = `${look.key}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const frame = characterFrame(look, 'stand', 's', 0);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const crop = { x: 3, y: 2, w: 18, h: 18 };
  const scale = Math.max(1, Math.floor(size / crop.w));
  const drawW = crop.w * scale;
  const drawH = crop.h * scale;
  ctx.drawImage(frame, crop.x, crop.y, crop.w, crop.h, Math.floor((size - drawW) / 2), size - drawH, drawW, drawH);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
