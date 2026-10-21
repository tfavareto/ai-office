// Collects static parts (geometry + material + transform) and merges them per material into a few meshes.
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { planMerge } from './mergePlan';

export interface Part {
  geometry: BufferGeometry;
  material: Material;
  matrix: Matrix4;
}

export interface ShadowFlags {
  cast: boolean;
  receive: boolean;
}

const boxCache = new Map<string, BoxGeometry>();
const cylCache = new Map<string, CylinderGeometry>();
const sphereCache = new Map<string, SphereGeometry>();
const q = new Quaternion();
const euler = new Euler();
const v = new Vector3();
const one = new Vector3(1, 1, 1);

/** Box with texture coordinates in metres divided by `texM`, so tiled materials keep their real-world scale. */
export function boxGeometry(sx: number, sy: number, sz: number, texM = 1): BoxGeometry {
  const key = `${sx.toFixed(3)}|${sy.toFixed(3)}|${sz.toFixed(3)}|${texM}`;
  let geo = boxCache.get(key);
  if (geo) return geo;
  geo = new BoxGeometry(sx, sy, sz);
  const uv = geo.getAttribute('uv');
  const dims: [number, number][] = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * dims[face][0]) / texM, (uv.getY(idx) * dims[face][1]) / texM);
    }
  }
  boxCache.set(key, geo);
  return geo;
}

export function cylinderGeometry(rTop: number, rBottom: number, h: number, segments = 20): CylinderGeometry {
  const key = `${rTop.toFixed(3)}|${rBottom.toFixed(3)}|${h.toFixed(3)}|${segments}`;
  let geo = cylCache.get(key);
  if (!geo) {
    geo = new CylinderGeometry(rTop, rBottom, h, segments);
    cylCache.set(key, geo);
  }
  return geo;
}

export function sphereGeometry(r: number, w = 16, h = 12): SphereGeometry {
  const key = `${r.toFixed(3)}|${w}|${h}`;
  let geo = sphereCache.get(key);
  if (!geo) {
    geo = new SphereGeometry(r, w, h);
    sphereCache.set(key, geo);
  }
  return geo;
}

/** A horizontal quad (y up) between two corners, with world-scale UVs. */
export function groundQuad(x0: number, z0: number, x1: number, z1: number, y: number, texM: number): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0], 3));
  geo.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute(
    'uv',
    new Float32BufferAttribute(
      [x0 / texM, z0 / texM, x0 / texM, z1 / texM, x1 / texM, z1 / texM, x1 / texM, z0 / texM],
      2,
    ),
  );
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

/** A vertical quad facing +z in local space (width w along x, height h along y), origin at its bottom centre. */
export function wallQuad(w: number, h: number): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, w / 2, h, 0, -w / 2, h, 0], 3));
  geo.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('uv', new Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

export function transform(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  q.setFromEuler(euler.set(rx, ry, rz, 'YXZ'));
  return new Matrix4().compose(v.set(x, y, z), q, one.set(sx, sy, sz));
}

/** Keeps only attributes every static part shares, so geometries of any origin can be merged. */
function normalized(geometry: BufferGeometry, matrix: Matrix4, nonIndexed: boolean): BufferGeometry {
  const out = new BufferGeometry();
  const source = nonIndexed && geometry.index ? geometry.toNonIndexed() : geometry;
  out.setAttribute('position', source.getAttribute('position').clone());
  out.setAttribute('normal', source.getAttribute('normal').clone());
  const uv = source.getAttribute('uv');
  out.setAttribute(
    'uv',
    uv ? uv.clone() : new Float32BufferAttribute(new Float32Array(source.getAttribute('position').count * 2), 2),
  );
  if (!nonIndexed && source.index) out.setIndex(source.index.clone());
  out.applyMatrix4(matrix);
  return out;
}

export class PartCollector {
  readonly parts: Part[] = [];

  add(geometry: BufferGeometry, material: Material, matrix: Matrix4 = new Matrix4()): this {
    this.parts.push({ geometry, material, matrix });
    return this;
  }

  box(
    material: Material,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    ry = 0,
    texM = 1,
  ): this {
    return this.add(boxGeometry(sx, sy, sz, texM), material, transform(cx, cy, cz, ry));
  }

  /** Box whose bottom face sits at y. */
  boxOn(
    material: Material,
    cx: number,
    y: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    ry = 0,
    texM = 1,
  ): this {
    return this.box(material, cx, y + sy / 2, cz, sx, sy, sz, ry, texM);
  }

  cylinder(material: Material, cx: number, y: number, cz: number, r: number, h: number, segments = 20, rTop = r): this {
    return this.add(cylinderGeometry(rTop, r, h, segments), material, transform(cx, y + h / 2, cz));
  }

  sphere(material: Material, cx: number, cy: number, cz: number, r: number, sx = 1, sy = 1, sz = 1): this {
    return this.add(sphereGeometry(r), material, transform(cx, cy, cz, 0, 0, 0, sx, sy, sz));
  }

  /** Adds all parts of another collector under a transform. */
  addAll(other: PartCollector, matrix: Matrix4): this {
    for (const p of other.parts)
      this.parts.push({
        geometry: p.geometry,
        material: p.material,
        matrix: new Matrix4().multiplyMatrices(matrix, p.matrix),
      });
    return this;
  }

  get vertexCount(): number {
    return this.parts.reduce((n, p) => n + p.geometry.getAttribute('position').count, 0);
  }

  /** Merges the parts per material (one mesh per batch). The result is static: matrixAutoUpdate is off. */
  build(shadowOf: (material: Material) => ShadowFlags): Object3D {
    const group = new Group();
    const batches = planMerge(
      this.parts.map((p) => ({ key: p.material.uuid, vertices: p.geometry.getAttribute('position').count })),
    );
    for (const batch of batches) {
      const members = batch.items.map((i) => this.parts[i]);
      const nonIndexed = members.some((m) => !m.geometry.index) && members.some((m) => m.geometry.index);
      const geos = members.map((m) => normalized(m.geometry, m.matrix, nonIndexed));
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new Mesh(merged, members[0].material);
      const flags = shadowOf(members[0].material);
      mesh.castShadow = flags.cast;
      mesh.receiveShadow = flags.receive;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    return group;
  }
}

export function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) mesh.geometry.dispose();
  });
}
