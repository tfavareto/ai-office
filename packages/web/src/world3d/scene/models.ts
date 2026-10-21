// CC0 glTF furniture and plants, flattened into parts (geometry + material + baked node transform) with their base on
// y = 0 and their footprint centred on the origin, so they can be merged into room meshes like procedural parts.
import { Box3, Matrix4, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Part } from '../util/parts';
import { PartCollector, transform } from '../util/parts';
import { ASSET_BASE } from './textures';

export const MODEL_FILES = {
  sofa: 'furniture/sofa_03/sofa_03.gltf',
  ottoman: 'furniture/Ottoman_01/Ottoman_01.gltf',
  diningChair: 'furniture/dining_chair_02/dining_chair_02.gltf',
  loungeChair: 'furniture/mid_century_lounge_chair/mid_century_lounge_chair.gltf',
  coffeeTable: 'furniture/modern_coffee_table_01/modern_coffee_table_01.gltf',
  cabinet: 'furniture/modern_wooden_cabinet/modern_wooden_cabinet.gltf',
  roundTable: 'furniture/round_wooden_table_01/round_wooden_table_01.gltf',
  sideTable: 'furniture/side_table_01/side_table_01.gltf',
  shelves: 'furniture/wooden_display_shelves_01/wooden_display_shelves_01.gltf',
  calathea: 'plants/calathea_orbifolia_01/calathea_orbifolia_01.gltf',
  fern: 'plants/fern_02/fern_02.gltf',
  pachira: 'plants/pachira_aquatica_01/pachira_aquatica_01.gltf',
  pottedPlant: 'plants/potted_plant_04/potted_plant_04.gltf',
} as const;

export type ModelName = keyof typeof MODEL_FILES;

export interface Model {
  parts: Part[];
  /** Size in metres of the normalised model. */
  size: Vector3;
}

export type Models = Record<ModelName, Model>;

function flatten(scene: import('three').Object3D): Model {
  scene.updateMatrixWorld(true);
  const raw: { geometry: BufferGeometry; material: Material; matrix: Matrix4 }[] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    raw.push({ geometry: mesh.geometry, material: mesh.material as Material, matrix: mesh.matrixWorld.clone() });
  });
  const box = new Box3().setFromObject(scene);
  const size = box.getSize(new Vector3());
  const recenter = new Matrix4().makeTranslation(
    -(box.min.x + box.max.x) / 2,
    -box.min.y,
    -(box.min.z + box.max.z) / 2,
  );
  return {
    size,
    parts: raw.map((r) => ({
      geometry: r.geometry,
      material: r.material,
      matrix: recenter.clone().multiply(r.matrix),
    })),
  };
}

export async function loadModels(): Promise<Models> {
  const loader = new GLTFLoader();
  const names = Object.keys(MODEL_FILES) as ModelName[];
  const loaded = await Promise.all(names.map((n) => loader.loadAsync(`${ASSET_BASE}/${MODEL_FILES[n]}`)));
  const out = {} as Models;
  names.forEach((n, i) => {
    out[n] = flatten(loaded[i].scene);
  });
  return out;
}

export interface PlaceOptions {
  /** Target width/depth/height in metres; unspecified axes keep the uniform scale. */
  width?: number;
  depth?: number;
  height?: number;
  /** Uniform scale used for axes without a target. */
  scale?: number;
  yaw?: number;
  y?: number;
}

/** Adds a model into a collector, scaled to the requested size. */
export function placeModel(c: PartCollector, model: Model, x: number, z: number, o: PlaceOptions = {}): void {
  const base = o.scale ?? 1;
  const sx = o.width ? o.width / model.size.x : base;
  const sy = o.height ? o.height / model.size.y : base;
  const sz = o.depth ? o.depth / model.size.z : base;
  const m = transform(x, o.y ?? 0, z, o.yaw ?? 0, 0, 0, sx, sy, sz);
  for (const p of model.parts) c.add(p.geometry, p.material, new Matrix4().multiplyMatrices(m, p.matrix));
}
