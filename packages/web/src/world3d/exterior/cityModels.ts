// Kenney CC0 city kit models (buildings, trees, cars), flattened to parts that share one material per kit.
import { Box3, Matrix4, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Model } from '../scene/models';
import { ASSET_BASE } from '../scene/textures';

export const BUILDINGS = [
  'commercial/building-a',
  'commercial/building-b',
  'commercial/building-c',
  'commercial/building-d',
  'commercial/building-f',
  'commercial/building-h',
  'commercial/building-n',
  'commercial/building-skyscraper-a',
  'commercial/building-skyscraper-c',
  'commercial/building-skyscraper-e',
] as const;
export const TREES = ['suburban/tree-large', 'suburban/tree-small'] as const;
export const CARS = [
  'cars/sedan',
  'cars/suv',
  'cars/taxi',
  'cars/delivery',
  'cars/hatchback-sports',
  'cars/van',
] as const;

export interface CityModels {
  buildings: Model[];
  trees: Model[];
  cars: Model[];
}

function flatten(scene: import('three').Object3D, material: Material): Model {
  scene.updateMatrixWorld(true);
  const raw: { geometry: BufferGeometry; matrix: Matrix4 }[] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) raw.push({ geometry: mesh.geometry, matrix: mesh.matrixWorld.clone() });
  });
  const box = new Box3().setFromObject(scene);
  const recenter = new Matrix4().makeTranslation(
    -(box.min.x + box.max.x) / 2,
    -box.min.y,
    -(box.min.z + box.max.z) / 2,
  );
  return {
    size: box.getSize(new Vector3()),
    parts: raw.map((r) => ({ geometry: r.geometry, material, matrix: recenter.clone().multiply(r.matrix) })),
  };
}

async function loadKit(loader: GLTFLoader, names: readonly string[]): Promise<Model[]> {
  const loaded = await Promise.all(names.map((n) => loader.loadAsync(`${ASSET_BASE}/city/${n}.glb`)));
  let shared: Material | null = null;
  return loaded.map((g) => {
    if (!shared) {
      g.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh && !shared) shared = mesh.material as Material;
      });
    }
    return flatten(g.scene, shared as Material);
  });
}

export async function loadCityModels(): Promise<CityModels> {
  const loader = new GLTFLoader();
  const [buildings, trees, cars] = await Promise.all([
    loadKit(loader, BUILDINGS),
    loadKit(loader, TREES),
    loadKit(loader, CARS),
  ]);
  return { buildings, trees, cars };
}
