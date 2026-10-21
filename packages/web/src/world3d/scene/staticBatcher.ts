// Merges the static meshes of every settled area into one mesh per material (draw calls drop from hundreds to a few
// dozen). It works incrementally, one material per call, and restores the per-area meshes the moment anything changes.
import { Group, Mesh, type Material } from 'three';
import { PartCollector, disposeObject } from '../util/parts';
import { shadowOf } from './materials';

export interface Batchable {
  /** Merged static meshes of an area (world-space geometry, identity transform). */
  staticMeshes(): Mesh[];
}

export class StaticBatcher {
  readonly group = new Group();
  private pending: Material[] | null = null;
  private hidden: Mesh[] = [];
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  get inProgress(): boolean {
    return this.pending !== null && this.pending.length > 0;
  }

  /** Restores every per-area mesh and frees the merged ones. */
  reset(): void {
    if (!this.active && !this.pending) return;
    for (const m of this.hidden) m.visible = true;
    this.hidden = [];
    for (const child of [...this.group.children]) {
      disposeObject(child);
      this.group.remove(child);
    }
    this.pending = null;
    this.active = false;
  }

  /** One incremental step; returns true while work remains. */
  step(areas: readonly Batchable[]): boolean {
    if (!this.pending) {
      const byMaterial = new Map<string, Material>();
      for (const a of areas)
        for (const mesh of a.staticMeshes())
          byMaterial.set((mesh.material as Material).uuid, mesh.material as Material);
      this.pending = [...byMaterial.values()];
      this.active = true;
    }
    const material = this.pending.shift();
    if (!material) return false;
    const members: Mesh[] = [];
    for (const a of areas)
      for (const mesh of a.staticMeshes()) if (mesh.material === material && mesh.visible) members.push(mesh);
    if (members.length > 1) {
      const collector = new PartCollector();
      for (const mesh of members) collector.add(mesh.geometry, material);
      const merged = collector.build(shadowOf);
      this.group.add(merged);
      for (const mesh of members) {
        mesh.visible = false;
        this.hidden.push(mesh);
      }
    }
    return this.pending.length > 0;
  }
}
