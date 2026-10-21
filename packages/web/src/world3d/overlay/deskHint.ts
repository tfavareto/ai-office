// Feedback for an empty desk under the pointer in the 3D world: a glowing outline flat on the desk and a world point for
// the "+" badge the label overlay draws over it.
import {
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import type { DeskTarget } from '../../sim/desks';
import { DESK_H, TILE_M } from '../units';

const COLOR = 0x6ea2ff;
/** Just above the desk top so the quad does not fight the table for the same depth. */
const LIFT = 0.04;
/** Tiles the outline reaches above the table (monitors) and below it (chair). */
const ABOVE_TILES = 0.15;
const BELOW_TILES = 0.95;
const BADGE_RISE = 0.5;

export class DeskHint3D {
  readonly group = new Group();
  private readonly fill: MeshBasicMaterial;
  private readonly edgeMaterial: LineBasicMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private desk: DeskTarget | null = null;

  constructor() {
    const plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const edges = new EdgesGeometry(plane);
    this.geometries.push(plane, edges);
    this.fill = new MeshBasicMaterial({
      color: COLOR,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: DoubleSide,
    });
    this.edgeMaterial = new LineBasicMaterial({ color: 0xbcd3ff, transparent: true, opacity: 0.95, depthWrite: false });
    const mesh = new Mesh(plane, this.fill);
    const outline = new LineSegments(edges, this.edgeMaterial);
    for (const part of [mesh, outline]) part.renderOrder = 20;
    this.group.add(mesh, outline);
    this.group.visible = false;
  }

  /** Shows the hint over a desk, or hides it. */
  set(desk: DeskTarget | null): void {
    this.desk = desk;
    this.group.visible = desk !== null;
    if (!desk) return;
    const depth = desk.rect.h + ABOVE_TILES + BELOW_TILES;
    this.group.scale.set(desk.rect.w * TILE_M, 1, depth * TILE_M);
    this.group.position.set(
      (desk.rect.x + desk.rect.w / 2) * TILE_M,
      DESK_H + LIFT,
      (desk.rect.y - ABOVE_TILES + depth / 2) * TILE_M,
    );
  }

  update(time: number, still: boolean): void {
    if (!this.desk) return;
    this.fill.opacity = still ? 0.22 : 0.2 + 0.08 * Math.sin(time * 5);
  }

  /** World point above the desk where the "+" badge goes (null when nothing is hovered). */
  badgeAnchor(out: Vector3): Vector3 | null {
    if (!this.desk) return null;
    const { rect } = this.desk;
    return out.set((rect.x + rect.w / 2) * TILE_M, DESK_H + BADGE_RISE, (rect.y + (rect.h + BELOW_TILES) / 2) * TILE_M);
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    this.fill.dispose();
    this.edgeMaterial.dispose();
  }
}
