// Texture loading (decoded off the main thread with ImageBitmapLoader, same-origin files only) and the procedural
// canvas textures: walnut, slats, rugs, light pools and the tower facade.
import {
  CanvasTexture, ClampToEdgeWrapping, ImageBitmapLoader, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, Texture, type ColorSpace,
} from 'three';
import { Rng } from '../../layout/rng';

export const ASSET_BASE = '/assets/3d';

export interface LoadOptions {
  srgb?: boolean;
  repeat?: boolean;
}

/** Loads image files into three.js textures. Bitmaps are decoded by the browser off the main thread. */
export class TextureLoader {
  private readonly loader = new ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  private readonly cache = new Map<string, Promise<Texture>>();
  anisotropy = 8;

  load(path: string, options: LoadOptions = {}): Promise<Texture> {
    const key = `${path}|${options.srgb ?? true}|${options.repeat ?? true}`;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = this.loader.loadAsync(`${ASSET_BASE}/${path}`).then((bitmap) => {
        const tex = new Texture(bitmap as unknown as HTMLImageElement);
        tex.flipY = false;
        tex.colorSpace = options.srgb === false ? ('' as ColorSpace) : SRGBColorSpace;
        tex.wrapS = tex.wrapT = options.repeat === false ? ClampToEdgeWrapping : RepeatWrapping;
        tex.anisotropy = this.anisotropy;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.needsUpdate = true;
        return tex;
      });
      this.cache.set(key, hit);
    }
    return hit;
  }
}

export function canvas2d(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, repeat = true, srgb = true): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = srgb ? SRGBColorSpace : ('' as ColorSpace);
  if (repeat) tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Warm walnut with long vertical grain (one repeat covers 1 m). */
export function walnutTexture(seed = 7, base = '#5a3a26'): CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  const rng = new Rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 520; i++) {
    const x = rng.range(0, 512);
    const w = rng.range(1, 5);
    const l = rng.range(0.25, 0.8);
    const y = rng.range(-100, 512);
    ctx.fillStyle = `rgba(${rng.chance(0.5) ? '30,16,8' : '150,100,64'},${rng.range(0.05, 0.2)})`;
    ctx.fillRect(x, y, w, l * 512);
  }
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(25,12,6,${rng.range(0.1, 0.25)})`;
    ctx.lineWidth = rng.range(0.6, 1.6);
    ctx.beginPath();
    const x = rng.range(0, 512);
    ctx.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) ctx.lineTo(x + Math.sin(y * 0.02 + i) * rng.range(2, 7), y);
    ctx.stroke();
  }
  return toTexture(canvas);
}

/** Vertical slats (one repeat = 0.72 m, 8 slats) separated by dark gaps. */
export function slatTexture(base = '#6b4630'): CanvasTexture {
  const { canvas, ctx } = canvas2d(256, 128);
  const rng = new Rng(11);
  ctx.fillStyle = '#120a06';
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 8; i++) {
    const x = i * 32 + 3;
    const g = ctx.createLinearGradient(x, 0, x + 26, 0);
    g.addColorStop(0, base);
    g.addColorStop(0.5, '#7d5538');
    g.addColorStop(1, base);
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 26, 128);
    for (let k = 0; k < 14; k++) {
      ctx.fillStyle = `rgba(30,16,8,${rng.range(0.08, 0.22)})`;
      ctx.fillRect(x + rng.range(0, 24), 0, rng.range(0.6, 2), 128);
    }
  }
  return toTexture(canvas);
}

/** Planks for outdoor decks (repeat = 1 m). */
export function deckTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(256, 256);
  const rng = new Rng(23);
  for (let i = 0; i < 8; i++) {
    const l = rng.range(30, 42);
    ctx.fillStyle = `hsl(28,${rng.range(32, 42)}%,${l}%)`;
    ctx.fillRect(0, i * 32, 256, 30);
    ctx.fillStyle = 'rgba(20,10,4,0.5)';
    ctx.fillRect(0, i * 32 + 30, 256, 2);
    for (let k = 0; k < 10; k++) {
      ctx.fillStyle = `rgba(30,15,6,${rng.range(0.05, 0.18)})`;
      ctx.fillRect(rng.range(0, 256), i * 32 + rng.range(2, 28), rng.range(20, 90), 1);
    }
  }
  return toTexture(canvas);
}

const rugCache = new Map<string, CanvasTexture>();

/** Rug / carpet pattern: 0 solid, 1 stripes, 2 checker, 3 diamond. One texture covers the whole rug (clamped). */
export function rugTexture(pattern: number, a: string, b: string, accent: string): CanvasTexture {
  const key = `${pattern}|${a}|${b}|${accent}`;
  let tex = rugCache.get(key);
  if (tex) return tex;
  const { canvas, ctx } = canvas2d(256, 256);
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = b;
  if (pattern === 1) for (let x = 0; x < 256; x += 32) ctx.fillRect(x, 0, 16, 256);
  else if (pattern === 2) for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? 0 : 32; x < 256; x += 64) ctx.fillRect(x, y, 32, 32);
  else if (pattern === 3) {
    for (let y = 0; y < 256; y += 64) {
      for (let x = 0; x < 256; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x + 32, y + 4);
        ctx.lineTo(x + 60, y + 32);
        ctx.lineTo(x + 32, y + 60);
        ctx.lineTo(x + 4, y + 32);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 248, 248);
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, 224, 224);
  tex = toTexture(canvas, false);
  rugCache.set(key, tex);
  return tex;
}

/** Soft white radial gradient used for floor light pools and lamp halos. */
export function glowTexture(): CanvasTexture {
  const { canvas, ctx } = canvas2d(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return toTexture(canvas, false);
}

export interface TowerTextures {
  map: CanvasTexture;
  emissive: CanvasTexture;
}

/** Glass curtain-wall facade: one repeat = 6 m wide by 13.6 m tall (4 storeys of 8 panes), lit windows are random. */
export function towerTextures(): TowerTextures {
  const size = 512;
  const day = canvas2d(size, size);
  const night = canvas2d(size, size);
  const rng = new Rng(99);
  day.ctx.fillStyle = '#243447';
  day.ctx.fillRect(0, 0, size, size);
  night.ctx.fillStyle = '#000';
  night.ctx.fillRect(0, 0, size, size);
  const cols = 8;
  const rows = 4;
  const cw = size / cols;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw;
      const y = r * rh;
      const g = day.ctx.createLinearGradient(x, y, x + cw, y + rh);
      g.addColorStop(0, '#7497b8');
      g.addColorStop(0.5, '#3f5f7e');
      g.addColorStop(1, '#2c445e');
      day.ctx.fillStyle = g;
      day.ctx.fillRect(x + 2, y + 10, cw - 4, rh - 20);
      if (rng.chance(0.38)) {
        const warm = rng.chance(0.7);
        night.ctx.fillStyle = warm ? `rgba(255,${rng.int(40) + 180},${rng.int(60) + 100},${rng.range(0.45, 0.9)})` : `rgba(${rng.int(40) + 170},${rng.int(30) + 205},255,${rng.range(0.4, 0.8)})`;
        night.ctx.fillRect(x + 2, y + 10, cw - 4, rh - 20);
      }
    }
    day.ctx.fillStyle = '#9aa4b0';
    day.ctx.fillRect(0, r * rh, size, 8);
  }
  return { map: toTexture(day.canvas), emissive: toTexture(night.canvas) };
}
