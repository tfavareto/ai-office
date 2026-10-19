// The compact city frame around the tower: streets and sidewalks at ground level far below the office floor, Kenney
// buildings, instanced trees and lamp posts, a few moving cars, and the glass tower shaft under the office slab.
import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3, type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { layoutExterior } from '../../layout/exterior';
import { BUILDING_H } from '../../layout/constants';
import { hash32 } from '../../layout/rng';
import { shadowOf, type Materials } from '../scene/materials';
import { SLAB_H, TILE_M as T } from '../units';
import { groundQuad, PartCollector, transform } from '../util/parts';
import type { CityModels } from './cityModels';
import type { Model } from '../scene/models';
import { towerTextures, type TowerTextures } from '../scene/textures';

/** Distance from the office floor down to street level (about 11 storeys). */
export const TOWER_H = 34;
const GROUND_Y = -TOWER_H;
const BUILDING_SCALE = 10;
const CAR_SCALE = 1.7;
const TREE_SCALE = 7.5;

interface Car {
  mesh: Mesh;
  axis: 'h' | 'v';
  dir: 1 | -1;
  pos: number;
  from: number;
  to: number;
  speed: number;
  offset: number;
}

function geometryOf(model: Model, scale: number, yaw = 0): BufferGeometry {
  const geos = model.parts.map((p) => {
    const g = p.geometry.clone();
    g.applyMatrix4(new Matrix4().multiplyMatrices(transform(0, 0, 0, yaw, 0, 0, scale, scale, scale), p.matrix));
    const stripped = new BufferGeometry();
    stripped.setAttribute('position', g.getAttribute('position'));
    stripped.setAttribute('normal', g.getAttribute('normal'));
    stripped.setAttribute('uv', g.getAttribute('uv'));
    if (g.index) stripped.setIndex(g.index);
    return stripped;
  });
  return mergeGeometries(geos, false) ?? new BufferGeometry();
}

export class CityScene {
  readonly group = new Group();
  private readonly tower = new Group();
  private readonly towerTex: TowerTextures = towerTextures();
  private readonly towerMat: MeshStandardMaterial;
  private readonly cars: Car[] = [];
  private builtFor = -1;
  private lampMaterial: Material | null = null;

  constructor(private readonly m: Materials, private readonly models: CityModels) {
    this.towerMat = new MeshStandardMaterial({
      map: this.towerTex.map, emissiveMap: this.towerTex.emissive, emissive: '#ffcf8a', emissiveIntensity: 0, metalness: 0.55, roughness: 0.22, side: DoubleSide, envMapIntensity: 1.2,
    });
    this.group.add(this.tower);
  }

  /** Rebuilds the parts that depend on the building width. */
  setBuildingWidth(widthTiles: number): void {
    if (widthTiles === this.builtFor) return;
    this.builtFor = widthTiles;
    for (const child of [...this.group.children]) if (child !== this.tower) {
      this.group.remove(child);
      child.traverse((o) => (o as Mesh).geometry?.dispose());
    }
    this.cars.length = 0;
    this.buildTower(widthTiles);
    this.buildGround(widthTiles);
  }

  private buildTower(widthTiles: number): void {
    this.tower.clear();
    const w = widthTiles * T + 0.5;
    const d = BUILDING_H * T + 0.5;
    const x0 = -0.25;
    const z0 = -0.25;
    const top = -SLAB_H;
    const bottom = GROUND_Y;
    const h = top - bottom;
    const sides: [number, number, number, number, number, number, number, number][] = [
      // x0, z0, x1, z1 (start/end on the plane), normal x, z, length
      [x0, z0 + d, x0 + w, z0 + d, 0, 1, w, 0],
      [x0 + w, z0 + d, x0 + w, z0, 1, 0, d, 0],
      [x0 + w, z0, x0, z0, 0, -1, w, 0],
      [x0, z0, x0, z0 + d, -1, 0, d, 0],
    ];
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    sides.forEach(([ax, az, bx, bz, nx, nz, len], i) => {
      const base = i * 4;
      pos.push(ax, top, az, bx, top, bz, bx, bottom, bz, ax, bottom, az);
      for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
      const u = len / 6;
      const v = h / 13.6;
      uv.push(0, v, u, v, u, 0, 0, 0);
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const shaft = new Mesh(g, this.towerMat);
    shaft.frustumCulled = false;
    this.tower.add(shaft);
    const slab = new PartCollector();
    slab.boxOn(this.m.plasterWarm, w / 2 + x0, top, d / 2 + z0, w + 0.5, SLAB_H - 0.04, d + 0.5, 0, 2);
    slab.boxOn(this.m.steel, w / 2 + x0, top + SLAB_H - 0.08, d / 2 + z0, w + 0.54, 0.04, d + 0.54);
    this.tower.add(slab.build(shadowOf));
  }

  private buildGround(widthTiles: number): void {
    const ex = layoutExterior(widthTiles);
    const c = new PartCollector();
    const y = GROUND_Y;
    const b = ex.bounds;
    c.add(groundQuad(b.x * T, b.y * T, (b.x + b.w) * T, (b.y + b.h) * T, y - 0.02, 1.6), this.m.floor('stone'));
    for (const r of ex.sidewalks) c.add(groundQuad(r.x * T, r.y * T, (r.x + r.w) * T, (r.y + r.h) * T, y, 1.6), this.m.floor('stone'));
    const asphalt = this.m.textured('asphalt_02', '#9aa0a8', 0.5, 1);
    for (const r of ex.streets) c.add(groundQuad(r.x * T, r.y * T, (r.x + r.w) * T, (r.y + r.h) * T, y + 0.01, 4), asphalt);
    const paint = this.m.solid('#e9e6dc', 0.7);
    for (const r of ex.crosswalks) {
      const horizontal = r.w > r.h;
      const n = Math.floor((horizontal ? r.w : r.h) / 0.7);
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * (horizontal ? r.w : r.h);
        if (horizontal) c.box(paint, (r.x + t) * T, y + 0.02, (r.y + r.h / 2) * T, 0.45, 0.01, r.h * T * 0.9);
        else c.box(paint, (r.x + r.w / 2) * T, y + 0.02, (r.y + t) * T, r.w * T * 0.9, 0.01, 0.45);
      }
    }
    for (const lane of ex.lanes) {
      if (lane.dir < 0) continue;
      const len = lane.to - lane.from;
      for (let t = 0; t < len; t += 3) {
        if (lane.axis === 'h') c.box(paint, (lane.from + t + 1) * T, y + 0.02, (lane.pos + 1.5) * T, 1.2, 0.01, 0.08);
      }
    }
    const grass = this.m.textured('grass_ground', '#7aa05a', 0.5, 1);
    for (const r of ex.grass) c.add(groundQuad(r.x * T, r.y * T, (r.x + r.w) * T, (r.y + r.h) * T, y + 0.005, 4), grass);
    this.group.add(c.build(shadowOf));
    this.addBuildings(ex.rooftops);
    this.addTrees(ex.trees, ex.lamps);
    this.addCars(ex.lanes);
  }

  private addBuildings(rooftops: ReturnType<typeof layoutExterior>['rooftops']): void {
    const c = new PartCollector();
    const mats = new Set<Material>();
    rooftops.forEach((r, i) => {
      const hh = hash32(i, 5);
      const north = r.rect.y * T < 0;
      const modelIdx = hh % this.models.buildings.length;
      const model = this.models.buildings[modelIdx];
      const scale = Math.min(BUILDING_SCALE, ((r.rect.w * T * 0.8) / model.size.x));
      let height = model.size.y * scale;
      const cap = north && r.rect.x * T > -4 ? 64 : TOWER_H - 6;
      if (height > cap) height = cap;
      const sy = height / model.size.y;
      const cx = (r.rect.x + r.rect.w / 2) * T;
      const cz = (r.rect.y + r.rect.h / 2) * T;
      for (const p of model.parts) {
        c.add(p.geometry, p.material, new Matrix4().multiplyMatrices(transform(cx, GROUND_Y, cz, ((hh >> 3) % 2) * Math.PI, 0, 0, scale, sy, scale), p.matrix));
        mats.add(p.material);
      }
    });
    const built = c.build(() => ({ cast: false, receive: false }));
    this.group.add(built);
  }

  private addTrees(trees: ReturnType<typeof layoutExterior>['trees'], lamps: ReturnType<typeof layoutExterior>['lamps']): void {
    const dummy = new Object3D();
    const q = new Quaternion();
    const models = this.models.trees;
    const groups: { model: Model; items: { x: number; z: number; s: number }[] }[] = models.map((model) => ({ model, items: [] }));
    for (const t of trees) groups[t.variant % groups.length].items.push({ x: t.x * T, z: t.y * T, s: TREE_SCALE * (0.8 + (hash32(t.x, t.y) % 40) / 100) });
    for (const g of groups) {
      if (!g.items.length) continue;
      const geo = geometryOf(g.model, 1);
      const mesh = new InstancedMesh(geo, g.model.parts[0].material, g.items.length);
      g.items.forEach((it, i) => {
        dummy.position.set(it.x, GROUND_Y, it.z);
        dummy.scale.setScalar(it.s);
        dummy.quaternion.copy(q.setFromAxisAngle(new Vector3(0, 1, 0), i * 1.3));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    const lampParts = new PartCollector();
    for (const l of lamps) {
      lampParts.cylinder(this.m.graphite, l.x * T, GROUND_Y, l.y * T, 0.07, 3.4, 8, 0.05);
      lampParts.box(this.m.led('#ffe2b3'), l.x * T, GROUND_Y + 3.45, l.y * T, 0.5, 0.08, 0.2);
    }
    this.group.add(lampParts.build(() => ({ cast: false, receive: false })));
  }

  private addCars(lanes: ReturnType<typeof layoutExterior>['lanes']): void {
    const geos = this.models.cars.map((model) => geometryOf(model, CAR_SCALE));
    let n = 0;
    for (const lane of lanes) {
      const count = lane.axis === 'h' ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const idx = (n + i) % geos.length;
        const mesh = new Mesh(geos[idx], this.models.cars[idx].parts[0].material);
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.cars.push({
          mesh, axis: lane.axis, dir: lane.dir, pos: lane.pos, from: lane.from, to: lane.to,
          speed: 3.2 + ((hash32(n, i) % 30) / 10), offset: (hash32(n + 1, i) % 1000) / 1000,
        });
      }
      n += 1;
    }
  }

  /** Moves the cars; `night` lights the tower windows. */
  update(time: number, night: number): void {
    this.towerMat.emissiveIntensity = night * 1.1;
    for (const car of this.cars) {
      const len = (car.to - car.from) * T;
      const t = ((time * car.speed + car.offset * len) % len + len) % len;
      const along = car.dir === 1 ? t : len - t;
      const s = car.from * T + along;
      if (car.axis === 'h') {
        car.mesh.position.set(s, GROUND_Y + 0.02, car.pos * T);
        car.mesh.rotation.y = car.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.mesh.position.set(car.pos * T, GROUND_Y + 0.02, s);
        car.mesh.rotation.y = car.dir === 1 ? 0 : Math.PI;
      }
    }
  }

  dispose(): void {
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
    this.towerMat.dispose();
    this.towerTex.map.dispose();
    this.towerTex.emissive.dispose();
    this.lampMaterial?.dispose();
    this.group.removeFromParent();
  }
}
