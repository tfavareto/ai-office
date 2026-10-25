// The fish and bubbles of the 3D aquarium: a few small meshes that swim inside the (static) tank. Cheap on purpose: two
// fish and three bubbles per tank, one shared geometry and material each.
import {
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { isDrawn } from '../../layout/decor';
import type { AreaLayout } from '../../layout/types';
import type { Evolution } from '../../world/evolution';
import { TILE_M as T } from '../units';
import { TANK } from './furnitureDecor';

const FISH = [
  { color: '#ff8a3d', speed: 0.55, phase: 0, lane: 0.28, depth: -0.08 },
  { color: '#ffd24a', speed: 0.38, phase: 2.2, lane: 0.42, depth: 0.1 },
] as const;
const BUBBLES = 3;

interface Swimmer {
  fish: Group;
  tank: { x: number; z: number };
  def: (typeof FISH)[number];
}

interface Bubble {
  mesh: Mesh;
  tank: { x: number; z: number };
  index: number;
}

export class AquariumLife {
  readonly group = new Group();
  private readonly swimmers: Swimmer[] = [];
  private readonly bubbles: Bubble[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];

  constructor(area: AreaLayout, evolution: Evolution) {
    const body = new SphereGeometry(0.045, 10, 8);
    const tail = new ConeGeometry(0.035, 0.07, 8);
    const bubble = new SphereGeometry(0.014, 8, 6);
    const bubbleMaterial = new MeshBasicMaterial({
      color: '#eaf8ff',
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.geometries.push(body, tail, bubble);
    this.materials.push(bubbleMaterial);
    for (const item of area.furniture) {
      if (item.kind !== 'aquarium' || item.decor === undefined || !isDrawn(item, evolution.decor)) continue;
      const tank = { x: (item.x + item.w / 2) * T, z: (item.y + item.h / 2) * T };
      for (const def of FISH) {
        const material = new MeshStandardMaterial({
          color: def.color,
          roughness: 0.5,
          emissive: def.color,
          emissiveIntensity: 0.15,
        });
        this.materials.push(material);
        const fish = new Group();
        const bodyMesh = new Mesh(body, material);
        bodyMesh.scale.set(1.5, 1, 0.55);
        const tailMesh = new Mesh(tail, material);
        tailMesh.rotation.z = Math.PI / 2;
        tailMesh.position.x = -0.085;
        tailMesh.scale.z = 0.4;
        fish.add(bodyMesh, tailMesh);
        this.group.add(fish);
        this.swimmers.push({ fish, tank, def });
      }
      for (let index = 0; index < BUBBLES; index++) {
        const mesh = new Mesh(bubble, bubbleMaterial);
        this.group.add(mesh);
        this.bubbles.push({ mesh, tank, index });
      }
    }
  }

  get isEmpty(): boolean {
    return this.swimmers.length === 0;
  }

  /** `time` in seconds; with `still` the fish rest where they are. */
  update(time: number, still: boolean): void {
    const span = TANK.w - 0.35;
    for (const { fish, tank, def } of this.swimmers) {
      const t = still ? def.phase : time * def.speed + def.phase;
      const swim = (Math.sin(t) + 1) / 2;
      fish.position.set(
        tank.x - span / 2 + swim * span,
        TANK.y + 0.06 + def.lane * (TANK.h - 0.2) + Math.sin(t * 2.3) * 0.015,
        tank.z + def.depth,
      );
      fish.rotation.y = Math.cos(t) > 0 ? 0 : Math.PI;
      fish.rotation.z = Math.sin(t * 6) * 0.05;
    }
    for (const { mesh, tank, index } of this.bubbles) {
      const rise = still ? index / BUBBLES : (((time * 0.25 + index / BUBBLES) % 1) + 1) % 1;
      mesh.position.set(
        tank.x + 0.12 + index * 0.05,
        TANK.y + 0.1 + rise * (TANK.h - 0.15),
        tank.z + 0.05 * (index - 1),
      );
    }
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }
}
