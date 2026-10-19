// All people in the scene: creates and removes Character3D instances to follow the simulation.
import { Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import type { OfficeSim } from '../../sim/sim';
import { Character3D, ringGeo } from './character3d';
import type { HumanLibrary } from './humanLibrary';

export interface CrowdFrame {
  time: number;
  dt: number;
  accountColor: (accountId: string) => string;
  selectedId: string | null;
  hoveredId: string | null;
  /** Show eyes and eyebrows (close-up views). */
  detail: boolean;
  still: boolean;
}

export class Crowd {
  readonly group = new Group();
  private readonly people = new Map<string, Character3D>();
  private rings: InstancedMesh;
  private readonly ringMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  private readonly tmpColor = new Color();
  private readonly tmpMatrix = new Matrix4();

  constructor(private readonly library: HumanLibrary, private readonly sim: OfficeSim) {
    this.rings = this.makeRings(64);
    this.group.add(this.rings);
  }

  private makeRings(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(ringGeo, this.ringMaterial, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  }

  get size(): number {
    return this.people.size;
  }

  sync(): void {
    const live = new Set<string>();
    for (const c of this.sim.characters) {
      live.add(c.id);
      if (!this.people.has(c.id)) {
        const person = new Character3D(this.library, c);
        this.people.set(c.id, person);
        this.group.add(person.root);
      }
    }
    for (const [id, person] of this.people) {
      if (live.has(id)) continue;
      person.dispose();
      this.people.delete(id);
    }
  }

  update(f: CrowdFrame): void {
    for (const c of this.sim.characters) {
      const person = this.people.get(c.id);
      if (!person) continue;
      person.update(c, {
        time: f.time,
        dt: f.dt,
        accountColor: f.accountColor(c.accountId),
        detail: f.detail || c.id === f.selectedId,
        selected: c.id === f.selectedId,
        hovered: c.id === f.hoveredId,
        still: f.still,
      });
    }
    this.updateRings();
  }

  /** One instanced mesh draws every account-colour ring at the people's feet. */
  private updateRings(): void {
    if (this.people.size > this.rings.instanceMatrix.count) {
      this.rings.removeFromParent();
      this.rings.dispose();
      this.rings = this.makeRings(Math.max(64, this.people.size * 2));
      this.group.add(this.rings);
    }
    let n = 0;
    for (const person of this.people.values()) {
      if (!person.ringVisible) continue;
      this.tmpMatrix.makeTranslation(person.root.position.x, 0.02, person.root.position.z);
      this.rings.setMatrixAt(n, this.tmpMatrix);
      this.rings.setColorAt(n, this.tmpColor.set(person.ringColor));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  get(id: string): Character3D | undefined {
    return this.people.get(id);
  }

  headTop(id: string, out: Vector3): Vector3 | null {
    const p = this.people.get(id);
    return p && p.root.visible ? p.headTop(out) : null;
  }

  dispose(): void {
    for (const p of this.people.values()) p.dispose();
    this.people.clear();
    this.group.removeFromParent();
  }
}
