// Little billboards and glows over a person in 3D that say what they are doing: the same marks as the 2D world
// (code glyphs, thought bubble, globe, question mark, delegating arrow, amber pulse, sparkles, terminal glow).
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { hash32 } from '../../layout/rng';
import type { Character } from '../../sim/types';
import { CODE_GLYPHS, glyph, thoughtBubble } from '../../world2d/fx/glyphs';

const cache = new Map<string, Texture>();

function textureOf(key: string, canvas: () => HTMLCanvasElement): Texture {
  let texture = cache.get(key);
  if (!texture) {
    texture = new CanvasTexture(canvas());
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = false;
    cache.set(key, texture);
  }
  return texture;
}

const glyphTexture = (name: string, color: string): Texture =>
  textureOf(`${name}|${color}`, () => glyph(name, color, 2));
const cloudTexture = (dots: number): Texture => textureOf(`cloud|${dots}`, () => thoughtBubble(dots));

const pulseGeo = new RingGeometry(0.42, 0.47, 48).rotateX(-Math.PI / 2);
const glowTex = textureOf('glow', () => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 16);
  grad.addColorStop(0, 'rgba(120,255,175,0.9)');
  grad.addColorStop(1, 'rgba(120,255,175,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return c;
});

const GLYPH_CYCLE = 1.1;
const GLYPH_COUNT = 3;
const ICON_SIZE = 0.3;
const SPARKLES = 5;
const SPARKLE_COLORS = ['#fff6e0', '#ffd23f', '#ff9ac2', '#9fe0ff'] as const;

const wave = (t: number, hz: number, phase = 0): number => Math.sin((t * hz + phase) * Math.PI * 2);

function sprite(size: number): Sprite {
  const s = new Sprite(new SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(size, size, 1);
  s.visible = false;
  s.renderOrder = 12;
  return s;
}

export class PersonFx {
  readonly root = new Group();
  private readonly icon = sprite(ICON_SIZE);
  private readonly cloud = sprite(0.5);
  private readonly glyphs = Array.from({ length: GLYPH_COUNT }, () => sprite(0.11));
  private readonly sparks = Array.from({ length: SPARKLES }, () => sprite(0.14));
  private readonly pulse: Mesh;
  private readonly pulseMaterial: MeshBasicMaterial;
  private readonly glow: Sprite;
  private readonly salt: number;

  constructor(
    private readonly height: number,
    seed: number,
  ) {
    this.salt = hash32(seed, 17) / 4294967296;
    this.cloud.scale.set(0.5, 0.36, 1);
    this.pulseMaterial = new MeshBasicMaterial({
      color: '#ffb020',
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.pulse = new Mesh(pulseGeo, this.pulseMaterial);
    this.pulse.position.y = 0.03;
    this.pulse.visible = false;
    const glowMaterial = new SpriteMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    });
    this.glow = new Sprite(glowMaterial);
    this.glow.scale.set(0.7, 0.7, 1);
    this.glow.visible = false;
    this.root.add(this.icon, this.cloud, this.pulse, this.glow, ...this.glyphs, ...this.sparks);
  }

  private show(s: Sprite, texture: Texture | null, x: number, y: number, opacity = 1): void {
    const material = s.material as SpriteMaterial;
    if (texture && material.map !== texture) {
      material.map = texture;
      material.needsUpdate = true;
    }
    s.visible = texture !== null && opacity > 0.02;
    material.opacity = opacity;
    s.position.set(x, y, 0);
  }

  private hideAll(): void {
    for (const s of [this.icon, this.cloud, this.glow, ...this.glyphs, ...this.sparks]) s.visible = false;
    this.pulse.visible = false;
  }

  /** `time` is the animation clock; `meetingSide` is -1/1: where the meeting room lies (screen left/right). */
  update(c: Character, time: number, still: boolean, meetingSide: number): void {
    this.hideAll();
    const top = this.height;
    const t = time + this.salt * 3;
    if (c.mood === 'waiting' || c.alert) this.amberPulse(still ? 0.3 : (time * 0.9) % 1);
    if (c.celebrationBadge) this.show(this.icon, glyphTexture('star', '#ffd23f'), 0.22, top + 0.05);
    if (still) return this.stillMark(c, top);
    switch (c.mood) {
      case 'typing':
        if (c.pose === 'typeFast') this.codeGlyphs(top, t);
        break;
      case 'terminal':
        this.terminal(c, top, t);
        break;
      case 'web': {
        const pulse = (t * 0.8) % 1;
        this.show(this.icon, glyphTexture('globe', '#6fb8ff'), 0, top + 0.12 + wave(t, 0.6) * 0.02, 1);
        this.icon.scale.setScalar(ICON_SIZE * (1 + pulse * 0.25));
        (this.icon.material as SpriteMaterial).opacity = 1 - pulse * 0.35;
        break;
      }
      case 'thinking':
        this.show(this.cloud, cloudTexture(1 + (Math.floor(t * 1.8) % 3)), 0.32, top + 0.18 + wave(t, 0.5) * 0.02);
        break;
      case 'frustrated':
        this.show(this.icon, glyphTexture('question', '#ff8a5c'), 0.2 + wave(t, 4) * 0.015, top + 0.1);
        break;
      case 'delegating':
        this.icon.scale.setScalar(ICON_SIZE);
        this.show(
          this.icon,
          glyphTexture('arrow', '#ffd23f'),
          meetingSide * (0.34 + (wave(t, 1.2) + 1) * 0.05),
          top - 0.1,
        );
        break;
      default:
        break;
    }
    if (c.celebrating) this.sparkles(top, t * 1.0 + this.salt * 5);
  }

  private stillMark(c: Character, top: number): void {
    if (c.mood === 'thinking') this.show(this.cloud, cloudTexture(3), 0.32, top + 0.18);
    else if (c.mood === 'web') this.show(this.icon, glyphTexture('globe', '#6fb8ff'), 0, top + 0.12);
    else if (c.mood === 'frustrated') this.show(this.icon, glyphTexture('question', '#ff8a5c'), 0.2, top + 0.1);
  }

  private amberPulse(phase: number): void {
    this.pulse.visible = true;
    const scale = 1 + phase * 0.9;
    this.pulse.scale.set(scale, 1, scale);
    this.pulseMaterial.opacity = (1 - phase) * 0.85;
  }

  private codeGlyphs(top: number, t: number): void {
    for (let k = 0; k < GLYPH_COUNT; k++) {
      const age = (t / GLYPH_CYCLE + k / GLYPH_COUNT) % 1;
      const cycle = Math.floor(t / GLYPH_CYCLE + k / GLYPH_COUNT);
      const name = CODE_GLYPHS[hash32(cycle, k + 3) % CODE_GLYPHS.length] as string;
      const s = this.glyphs[k] as Sprite;
      this.show(
        s,
        glyphTexture(name, '#7ee0a0'),
        -0.16 + k * 0.16 + wave(age, 1.3, k) * 0.03,
        top - 0.38 + age * 0.55,
        Math.min(1, (1 - age) * 1.6),
      );
    }
  }

  private terminal(c: Character, top: number, t: number): void {
    if (!c.seat) return;
    this.glow.visible = true;
    this.glow.position.set(0, top - 0.55, 0.3);
    (this.glow.material as SpriteMaterial).opacity = 0.3 + 0.1 * wave(t, 2.3) + 0.04 * wave(t, 5.1);
  }

  private sparkles(top: number, t: number): void {
    for (let k = 0; k < SPARKLES; k++) {
      const twinkle = (t * 2.2 + k * 0.37) % 1;
      if (twinkle > 0.6) continue;
      const angle = k * 1.26 + t * 1.3;
      const s = this.sparks[k] as Sprite;
      this.show(
        s,
        glyphTexture('spark', SPARKLE_COLORS[k % SPARKLE_COLORS.length] as string),
        Math.cos(angle) * 0.42,
        top - 0.5 + Math.sin(angle) * 0.25 + twinkle * 0.2,
        1 - twinkle / 0.6,
      );
      s.position.z = Math.sin(angle) * 0.42;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.pulseMaterial.dispose();
    this.glow.material.dispose();
    for (const s of [this.icon, this.cloud, ...this.glyphs, ...this.sparks]) s.material.dispose();
  }
}
