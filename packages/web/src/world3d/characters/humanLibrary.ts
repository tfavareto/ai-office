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
import { facePartOf } from './facePart';
import { warmRedIris } from './irisColor';
import { FEMALE_MODELS, MALE_MODELS, type LookChoice } from './outfits';

/** The body (and with it the face) and the hair are told apart by their material. */
const SKIN_MATERIAL = 'Human.body';
const HAIR_MATERIAL = /^Human\.(short|bob|afro|long)\d+$/;

/** Mean brightness (0-255) the skin and hair textures are brought to before a color is multiplied on them. */
const SKIN_BASE = 235;
const HAIR_BASE = 175;
const BROW_BASE = 150;
/** The brows are a shade darker than the hair. */
const BROW_DARKEN = 0.8;

export interface HumanInstance {
  root: Object3D;
  meshes: Mesh[];
}

interface Template {
  scene: Object3D;
}

/** A texture of the same image after `edit` changed its RGBA pixels (a new array in, a new array out). */
function editedTexture(source: Texture, edit: (pixels: Uint8ClampedArray) => Uint8ClampedArray): CanvasTexture {
  const image = source.image as ImageBitmap | HTMLImageElement;
  const { canvas, ctx } = canvas2d((image as ImageBitmap).width, (image as ImageBitmap).height);
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  data.data.set(edit(data.data));
  ctx.putImageData(data, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = source.flipY;
  tex.anisotropy = 8;
  tex.wrapS = source.wrapS;
  tex.wrapT = source.wrapT;
  return tex;
}

/** The grey-scale of `px` with its brightness brought to `base` over the opaque pixels. */
function neutralPixels(px: Uint8ClampedArray, base: number): Uint8ClampedArray {
  let sum = 0;
  let counted = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    sum += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
    counted++;
  }
  const gain = base / (sum / counted || 1);
  const out = new Uint8ClampedArray(px);
  for (let i = 0; i < out.length; i += 4) {
    const l = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) * gain;
    out[i] = out[i + 1] = out[i + 2] = l;
  }
  return out;
}

/**
 * Grey-scales a texture and normalises its brightness (to `base`, over the opaque pixels) so that a colour multiplied on
 * it gives a true tint.
 */
function neutralTexture(source: Texture, base = 190): CanvasTexture {
  return editedTexture(source, (px) => neutralPixels(px, base));
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

  /** The eyeballs of a model: the same material, with the iris texture warmed when it is a red brown. */
  private eyeMaterial(source: MeshStandardMaterial): MeshStandardMaterial {
    const key = `eyes|${source.name}`;
    let mat = this.tints.get(key);
    if (mat) return mat;
    mat = source.clone();
    if (source.map && source.name === 'eyes_brown') mat.map = editedTexture(source.map, warmRedIris);
    this.tints.set(key, mat);
    return mat;
  }

  /** The brows in the hair color (a little darker), from the grey-scale brow texture. */
  private browMaterial(source: MeshStandardMaterial, hex: string): MeshStandardMaterial {
    const key = `brow|${hex}`;
    let mat = this.tints.get(key);
    if (mat) return mat;
    let tex = this.neutral.get('brow');
    if (!tex && source.map) {
      tex = neutralTexture(source.map, BROW_BASE);
      this.neutral.set('brow', tex);
    }
    mat = source.clone();
    if (tex) mat.map = tex;
    mat.color = new Color(hex).multiplyScalar(BROW_DARKEN);
    this.tints.set(key, mat);
    return mat;
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
  create(modelName: string, outfit: string, colors: Partial<Pick<LookChoice, 'skin' | 'hair'>> = {}): HumanInstance {
    const template = this.templates.get(modelName);
    if (!template) throw new Error(`human model not loaded: ${modelName}`);
    const root = SkeletonUtils.clone(template.scene);
    const meshes: Mesh[] = [];
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      meshes.push(mesh);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material as Material;
      const face = facePartOf(mesh.name, mat.name);
      if (face === 'eyes') mesh.material = this.eyeMaterial(mat as MeshStandardMaterial);
      else if (face === 'eyebrows' && colors.hair !== undefined)
        mesh.material = this.browMaterial(mat as MeshStandardMaterial, colors.hair);
      else if (mat.name.includes('elegantsuit'))
        mesh.material = this.suitMaterial(modelName, mat as MeshStandardMaterial, outfit);
      else if (colors.skin !== undefined && mat.name === SKIN_MATERIAL)
        mesh.material = this.tinted('skin', modelName, mat as MeshStandardMaterial, colors.skin);
      else if (colors.hair !== undefined && HAIR_MATERIAL.test(mat.name))
        mesh.material = this.tinted('hair', modelName, mat as MeshStandardMaterial, colors.hair);
    });
    return { root, meshes };
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
