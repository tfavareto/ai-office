// Loads the MakeHuman glTF models once and builds agent instances from them (skinned clones sharing geometry, with a
// per-outfit tinted suit material). Same-origin files only.
import {
  CanvasTexture,
  Color,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { canvas2d, ASSET_BASE } from '../scene/textures';
import { FEMALE_MODELS, MALE_MODELS, type LookChoice } from './outfits';

const DETAIL_MESHES = new Set(['eyebrow001', 'eyelashes02', 'low-poly']);
/** The body (and with it the face) and the hair are told apart by their material. */
const SKIN_MATERIAL = 'Human.body';
const HAIR_MATERIAL = /^Human\.(short|bob|afro|long)\d+$/;

/** Mean brightness (0-255) the skin and hair textures are brought to before a color is multiplied on them. */
const SKIN_BASE = 235;
const HAIR_BASE = 175;

export interface HumanInstance {
  root: Object3D;
  /** Eyes, eyebrows and lashes (only the full-detail models have them). */
  detail: Mesh[];
  meshes: Mesh[];
}

interface Template {
  scene: Object3D;
}

/**
 * Grey-scales a texture and normalises its brightness (to `base`, over the opaque pixels) so that a colour multiplied on
 * it gives a true tint.
 */
function neutralTexture(source: Texture, base = 190): CanvasTexture {
  const image = source.image as ImageBitmap | HTMLImageElement;
  const w = (image as ImageBitmap).width;
  const h = (image as ImageBitmap).height;
  const { canvas, ctx } = canvas2d(w, h);
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  let counted = 0;
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    sum += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
    counted++;
  }
  const mean = sum / counted || 1;
  const gain = base / mean;
  for (let i = 0; i < px.length; i += 4) {
    const l = Math.min(255, (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) * gain);
    px[i] = px[i + 1] = px[i + 2] = l;
  }
  ctx.putImageData(data, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = source.flipY;
  tex.anisotropy = 8;
  tex.wrapS = source.wrapS;
  tex.wrapT = source.wrapT;
  return tex;
}

export class HumanLibrary {
  private readonly templates = new Map<string, Template>();
  private readonly neutral = new Map<string, CanvasTexture>();
  private readonly suits = new Map<string, MeshStandardMaterial>();
  private readonly tints = new Map<string, MeshStandardMaterial>();

  static async load(): Promise<HumanLibrary> {
    const lib = new HumanLibrary();
    const loader = new GLTFLoader();
    const names = [...MALE_MODELS, ...FEMALE_MODELS];
    const loaded = await Promise.all(names.map((n) => loader.loadAsync(`${ASSET_BASE}/${n}.gltf`)));
    names.forEach((n, i) => {
      loaded[i].scene.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) mesh.frustumCulled = true;
      });
      lib.templates.set(n, { scene: loaded[i].scene });
    });
    return lib;
  }

  private suitMaterial(modelName: string, source: MeshStandardMaterial, tint: string): MeshStandardMaterial {
    const kind = modelName.includes('/f') ? 'f' : 'm';
    const key = `${kind}|${tint}`;
    let mat = this.suits.get(key);
    if (mat) return mat;
    let tex = this.neutral.get(kind);
    if (!tex && source.map) {
      tex = neutralTexture(source.map);
      this.neutral.set(kind, tex);
    }
    mat = source.clone();
    if (tex) mat.map = tex;
    mat.color = new Color(tint);
    mat.roughness = 0.78;
    mat.metalness = 0;
    mat.envMapIntensity = 0.6;
    this.suits.set(key, mat);
    return mat;
  }

  /** A copy of `source` whose texture is neutral and whose color is `hex`: skin or hair in the color a person chose. */
  private tinted(
    part: 'skin' | 'hair',
    modelName: string,
    source: MeshStandardMaterial,
    hex: string,
  ): MeshStandardMaterial {
    const key = `${part}|${modelName}|${hex}`;
    let mat = this.tints.get(key);
    if (mat) return mat;
    const textureKey = `${part}|${modelName}`;
    let tex = this.neutral.get(textureKey);
    if (!tex && source.map) {
      tex = neutralTexture(source.map, part === 'skin' ? SKIN_BASE : HAIR_BASE);
      this.neutral.set(textureKey, tex);
    }
    mat = source.clone();
    if (tex) mat.map = tex;
    // The textures are brought below full brightness (to keep their detail); the color makes up for it.
    mat.color = new Color(hex).multiplyScalar(part === 'skin' ? 1.15 : 1.1);
    this.tints.set(key, mat);
    return mat;
  }

  /** Skinned clone of a model with the outfit tint applied, and the skin and hair colors when they were chosen. */
  create(modelName: string, outfit: string, colors: Pick<LookChoice, 'skin' | 'hair'> = {}): HumanInstance {
    const template = this.templates.get(modelName);
    if (!template) throw new Error(`human model not loaded: ${modelName}`);
    const root = SkeletonUtils.clone(template.scene);
    const meshes: Mesh[] = [];
    const detail: Mesh[] = [];
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      meshes.push(mesh);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material as Material;
      if (mat.name.includes('elegantsuit'))
        mesh.material = this.suitMaterial(modelName, mat as MeshStandardMaterial, outfit);
      else if (colors.skin !== undefined && mat.name === SKIN_MATERIAL)
        mesh.material = this.tinted('skin', modelName, mat as MeshStandardMaterial, colors.skin);
      else if (colors.hair !== undefined && HAIR_MATERIAL.test(mat.name))
        mesh.material = this.tinted('hair', modelName, mat as MeshStandardMaterial, colors.hair);
      if (DETAIL_MESHES.has(mesh.name)) detail.push(mesh);
    });
    return { root, detail, meshes };
  }

  /** Every texture the models use (for progressive GPU upload). */
  textures(): Texture[] {
    const out = new Set<Texture>();
    for (const t of this.templates.values()) {
      t.scene.traverse((o) => {
        const mat = (o as Mesh).material as MeshStandardMaterial | undefined;
        if (!mat) return;
        for (const tex of [mat.map, mat.normalMap, mat.roughnessMap]) if (tex) out.add(tex);
      });
    }
    return [...out];
  }

  dispose(): void {
    for (const t of this.neutral.values()) t.dispose();
    for (const m of this.suits.values()) m.dispose();
    for (const m of this.tints.values()) m.dispose();
  }
}
