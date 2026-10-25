// Shared PBR materials. Everything is created once (after the textures are decoded) so no shader recompiles happen when
// rooms appear. UVs are in metres divided by the texture size, see TEXTURE_M.
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector2,
  type Material,
  type Texture,
} from 'three';
import type { AreaTheme } from '../../layout/types';
import { mix } from '../../world2d/color';
import {
  brickTexture,
  glowTexture,
  rugTexture,
  slatTexture,
  walnutTexture,
  deckTexture,
  type TextureLoader,
} from './textures';

export type FloorKind = AreaTheme['floor'];

export interface TextureSet {
  diff: Texture;
  nor?: Texture;
  rough?: Texture;
}

const SETS = [
  'marble_01',
  'large_grey_tiles',
  'herringbone_parquet',
  'rectangular_paving',
  'fabric_pattern_07',
  'concrete_wall_008',
  'leather_white',
  'asphalt_02',
  'grass_ground',
] as const;
export type SetName = (typeof SETS)[number];
const NO_NORMAL: ReadonlySet<SetName> = new Set(['asphalt_02', 'grass_ground']);

/** Real-world size in metres of one texture repeat. */
export const TEXTURE_M: Record<SetName, number> = {
  marble_01: 2.4,
  large_grey_tiles: 1.8,
  herringbone_parquet: 1.6,
  rectangular_paving: 1.6,
  fabric_pattern_07: 0.7,
  concrete_wall_008: 2.2,
  leather_white: 0.8,
  asphalt_02: 4,
  grass_ground: 4,
};

export type TextureSets = Record<SetName, TextureSet>;

export async function loadTextureSets(loader: TextureLoader): Promise<TextureSets> {
  const entries = await Promise.all(
    SETS.map(async (name) => {
      const [diff, nor, rough] = await Promise.all([
        loader.load(`textures/${name}/diff.jpg`),
        NO_NORMAL.has(name) ? Promise.resolve(undefined) : loader.load(`textures/${name}/nor.jpg`, { srgb: false }),
        loader.load(`textures/${name}/rough.jpg`, { srgb: false }),
      ]);
      return [name, { diff, nor, rough }] as const;
    }),
  );
  return Object.fromEntries(entries) as TextureSets;
}

export interface ShadowMeta {
  cast: boolean;
  receive: boolean;
}

export const shadowOf = (material: Material): ShadowMeta =>
  (material.userData.shadow as ShadowMeta | undefined) ?? { cast: true, receive: true };

function tag<T extends Material>(m: T, shadow: ShadowMeta): T {
  m.userData.shadow = shadow;
  return m;
}

function std(
  color: string,
  rough: number,
  metal = 0,
  extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {},
): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

export class Materials {
  readonly plaster: MeshStandardMaterial;
  readonly plasterWarm: MeshStandardMaterial;
  readonly graphite = std('#23272f', 0.5, 0.55);
  readonly steel = std('#9aa2ad', 0.32, 0.95);
  readonly brass = std('#c9a456', 0.3, 1);
  readonly black = std('#14161a', 0.55, 0.1);
  readonly whiteGloss = std('#f1f1ee', 0.22, 0.05);
  readonly ceramic = std('#fbfbf8', 0.12, 0);
  readonly rubber = std('#17181b', 0.85);
  readonly felt = std('#1d5f4a', 0.95);
  readonly walnut: MeshStandardMaterial;
  readonly walnutDark: MeshStandardMaterial;
  readonly slats: MeshStandardMaterial;
  readonly marbleWall: MeshStandardMaterial;
  readonly tileWhite: MeshStandardMaterial;
  readonly screenOff = std('#0a0d12', 0.2, 0.6);
  readonly glass = tag(
    new MeshStandardMaterial({
      color: '#cfe6f2',
      roughness: 0.06,
      metalness: 0.0,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: DoubleSide,
      envMapIntensity: 1.4,
    }),
    { cast: false, receive: false },
  );
  readonly frost = tag(
    new MeshStandardMaterial({
      color: '#f4f8fb',
      roughness: 0.5,
      metalness: 0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: DoubleSide,
    }),
    { cast: false, receive: false },
  );
  /** Frosting of a glass wall that changes with occupancy (meeting room). */
  readonly frostLive = tag(
    new MeshStandardMaterial({
      color: '#f4f8fb',
      roughness: 0.5,
      metalness: 0,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: DoubleSide,
    }),
    { cast: false, receive: false },
  );
  readonly mirror = std('#cfd8df', 0.04, 1);
  readonly glow = tag(
    new MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      toneMapped: false,
    }),
    { cast: false, receive: false },
  );

  private readonly floors = new Map<string, MeshStandardMaterial>();
  private readonly walls = new Map<string, MeshStandardMaterial>();
  private readonly leds = new Map<string, MeshBasicMaterial>();
  private readonly fabrics = new Map<string, MeshStandardMaterial>();
  private readonly rugs = new Map<string, MeshStandardMaterial>();
  private readonly extra: Material[] = [];

  constructor(readonly sets: TextureSets) {
    this.plaster = this.textured('concrete_wall_008', '#f1ece3', 0.92, 0.4);
    this.plasterWarm = this.textured('concrete_wall_008', '#e6d9c4', 0.92, 0.4);
    this.marbleWall = this.textured('marble_01', '#f6f1ea', 0.25, 0.3);
    this.tileWhite = this.textured('large_grey_tiles', '#f4f6f6', 0.3, 0.25);
    this.walnut = this.canvasWood(walnutTexture(7), 0.5);
    this.walnutDark = this.canvasWood(walnutTexture(13, '#3b261a'), 0.45);
    this.slats = this.canvasWood(slatTexture(), 0.55);
    this.extra.push(
      this.plaster,
      this.plasterWarm,
      this.marbleWall,
      this.tileWhite,
      this.walnut,
      this.walnutDark,
      this.slats,
    );
  }

  private canvasWood(map: Texture, rough: number): MeshStandardMaterial {
    return std('#ffffff', rough, 0.05, { map });
  }

  textured(set: SetName, tint: string, normalScale = 0.6, roughMul = 1): MeshStandardMaterial {
    const t = this.sets[set];
    const m = new MeshStandardMaterial({
      color: tint,
      map: t.diff,
      roughnessMap: t.rough,
      roughness: roughMul,
      metalness: 0,
    });
    if (t.nor) {
      m.normalMap = t.nor;
      m.normalScale = new Vector2(normalScale, normalScale);
    }
    return m;
  }

  /** Wall surface a person chose for a project room; `accent` tints the plaster. */
  wall(kind: 'plaster' | 'brick' | 'concrete', accent: string): MeshStandardMaterial {
    const key = kind === 'plaster' ? `plaster|${accent}` : kind;
    let m = this.walls.get(key);
    if (!m) {
      m =
        kind === 'brick'
          ? this.canvasWood(brickTexture(), 0.85)
          : kind === 'concrete'
            ? this.textured('concrete_wall_008', '#a3a8ad', 0.9, 0.5)
            : this.textured('concrete_wall_008', mix('#f1ece3', accent, 0.2), 0.92, 0.4);
      this.walls.set(key, m);
      this.extra.push(m);
    }
    return m;
  }

  floor(kind: FloorKind, carpetTint = '#4a5466'): MeshStandardMaterial {
    const key = kind === 'carpet' ? `carpet|${carpetTint}` : kind;
    let m = this.floors.get(key);
    if (m) return tag(m, { cast: false, receive: true });
    switch (kind) {
      case 'marble':
        m = this.textured('marble_01', '#f2ece3', 0.35, 0.55);
        break;
      case 'tile':
        m = this.textured('large_grey_tiles', '#e9eeee', 0.4, 0.5);
        break;
      case 'wood':
        m = this.textured('herringbone_parquet', '#bda78d', 0.6, 0.8);
        break;
      case 'parquet':
        m = this.textured('herringbone_parquet', '#d9cdbb', 0.6, 0.8);
        break;
      case 'stone':
        m = this.textured('rectangular_paving', '#e2ddd3', 0.5, 0.7);
        break;
      case 'slate':
        m = this.textured('large_grey_tiles', '#8d939b', 0.5, 0.8);
        break;
      case 'deck':
        m = std('#ffffff', 0.7, 0, { map: deckTexture() });
        break;
      default:
        m = this.textured('fabric_pattern_07', carpetTint, 0.9, 1);
        break;
    }
    this.floors.set(key, m);
    this.extra.push(m);
    return tag(m, { cast: false, receive: true });
  }

  led(hex: string): MeshBasicMaterial {
    let m = this.leds.get(hex);
    if (!m) {
      m = new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(1.6), toneMapped: false });
      this.leds.set(hex, tag(m, { cast: false, receive: false }));
    }
    return m;
  }

  fabric(hex: string, rough = 0.95): MeshStandardMaterial {
    const key = `${hex}|${rough}`;
    let m = this.fabrics.get(key);
    if (!m) {
      m = std(hex, rough);
      this.fabrics.set(key, m);
    }
    return m;
  }

  leather(hex: string): MeshStandardMaterial {
    const key = `leather|${hex}`;
    let m = this.fabrics.get(key);
    if (!m) {
      m = this.textured('leather_white', hex, 0.6, 0.9);
      this.fabrics.set(key, m);
    }
    return m;
  }

  /** Rug with a procedural pattern; its UVs span the rug (0..1). */
  rug(pattern: number, a: string, b: string, accent: string): MeshStandardMaterial {
    const key = `${pattern}|${a}|${b}|${accent}`;
    let m = this.rugs.get(key);
    if (!m) {
      m = tag(
        std('#ffffff', 0.97, 0, {
          map: rugTexture(pattern, a, b, accent),
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
        { cast: false, receive: true },
      );
      this.rugs.set(key, m);
    }
    return m;
  }

  /** Plain coloured standard material, cached by its parameters. */
  solid(hex: string, rough = 0.6, metal = 0): MeshStandardMaterial {
    const key = `solid|${hex}|${rough}|${metal}`;
    let m = this.fabrics.get(key);
    if (!m) {
      m = std(hex, rough, metal);
      this.fabrics.set(key, m);
    }
    return m;
  }

  all(): Material[] {
    return [
      this.graphite,
      this.steel,
      this.brass,
      this.black,
      this.whiteGloss,
      this.ceramic,
      this.rubber,
      this.felt,
      this.screenOff,
      this.glass,
      this.frost,
      this.frostLive,
      this.mirror,
      this.glow,
      ...this.extra,
      ...this.leds.values(),
      ...this.fabrics.values(),
      ...this.rugs.values(),
    ];
  }

  dispose(): void {
    for (const m of this.all()) m.dispose();
  }
}
