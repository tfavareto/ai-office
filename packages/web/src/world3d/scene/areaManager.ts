// Keeps one AreaScene per layout area in sync with the simulation: builds new or moved areas (a few per frame, so no
// long task), disposes stale ones, drives room build/dismantle animation and per-frame updates.
import { Group, Mesh, PlaneGeometry, type Box3 } from 'three';
import { type WorldText, worldText } from '../../i18n/world/translate';
import type { AreaLayout, BuildingLayout } from '../../layout/types';
import type { OfficeSim } from '../../sim/sim';
import { CORRIDOR_Y } from '../../layout/constants';
import { TILE_M as T } from '../units';
import { PartCollector, disposeObject } from '../util/parts';
import { AreaScene, type AreaFrame, type SceneDeps } from './areaScene';
import { shadowOf } from './materials';
import { StaticBatcher } from './staticBatcher';
import { TickerStrip, type BoardInfo, type DeskState } from './screens';
import type { TaskBoardSummary } from '../../world/taskBoard';
import { buildOuterFacades } from './shell';

interface Entry {
  scene: AreaScene;
  signature: string;
  /** Eased 0..1 lighting of the area at night. */
  lit: number;
}

export interface AreaInputs {
  time: number;
  dt: number;
  night: number;
  refreshScreens: boolean;
  info: (projectId: string) => BoardInfo;
  namesIn: (areaId: string) => readonly string[];
  taskBoard: TaskBoardSummary;
  desksIn: (area: AreaLayout) => readonly DeskState[];
  occupied: (areaId: string) => boolean;
  tickerText: string;
  isVisible: (box: Box3) => boolean;
}

const BUILD_BUDGET_MS = 9;

const emptyInfo: BoardInfo = { agents: 0, working: 0, waiting: 0, tasksTotal: 0, tasksDone: 0, current: null };

function signatureOf(area: AreaLayout, building: BuildingLayout): string {
  const r = area.rect;
  const base = `${area.kind}|${r.x},${r.y},${r.w},${r.h}|${area.label}|${area.theme.carpet}|${area.furniture.length}`;
  if (area.kind === 'terrace' || area.kind === 'corridor') return `${base}|${building.width}|${area.doors.length}`;
  return base;
}

export class AreaManager {
  readonly group = new Group();
  readonly batcher = new StaticBatcher();
  private stableFrames = 0;
  private readonly entries = new Map<string, Entry>();
  private readonly queue: AreaLayout[] = [];
  private outer: { group: Group; width: number } | null = null;
  private readonly ticker = new TickerStrip();
  private tickerMesh: Mesh | null = null;
  private tickerWidth = -1;
  private builtVersion = -1;
  private lastBuilding: BuildingLayout | null = null;
  private text: WorldText = worldText('pt-BR');

  constructor(private readonly deps: SceneDeps, private readonly sim: OfficeSim) {
    this.group.add(this.batcher.group);
  }

  /** Language of the texts painted on screens, boards and signs; built areas repaint in place (no rebuild). */
  setText(text: WorldText): void {
    if (text.locale === this.text.locale) return;
    this.text = text;
    for (const entry of this.entries.values()) entry.scene.setText(text);
  }

  get pending(): number {
    return this.queue.length;
  }

  private desired(building: BuildingLayout): AreaLayout[] {
    return [...building.areas, building.corridor, ...building.terraces];
  }

  /** Reconciles with the current layout; builds queued areas within a time budget (`all` ignores the budget). */
  sync(all = false): void {
    const building = this.sim.building;
    if (this.sim.layoutVersion !== this.builtVersion) {
      this.builtVersion = this.sim.layoutVersion;
      this.lastBuilding = building;
      const wanted = new Map(this.desired(building).map((a) => [a.id, a]));
      for (const [id, entry] of this.entries) {
        const area = wanted.get(id);
        if (!area || entry.signature !== signatureOf(area, building)) {
          entry.scene.dispose();
          this.entries.delete(id);
          this.batcher.reset();
          this.stableFrames = 0;
        }
      }
      for (const area of wanted.values()) {
        if (!this.entries.has(area.id) && !this.queue.some((q) => q.id === area.id)) this.queue.push(area);
      }
      this.queue.sort((a, b) => Number(a.kind === 'project') - Number(b.kind === 'project'));
      for (let i = this.queue.length - 1; i >= 0; i--) if (!wanted.has(this.queue[i].id)) this.queue.splice(i, 1);
      this.syncOuter(building);
      this.syncTicker(building);
    }
    const start = performance.now();
    while (this.queue.length && (all || performance.now() - start < BUILD_BUDGET_MS)) {
      const area = this.queue.shift()!;
      this.build(area, this.lastBuilding ?? building);
    }
  }

  private build(area: AreaLayout, building: BuildingLayout): void {
    const room = this.sim.rooms.byArea(area.id);
    const scene = new AreaScene(area, building, this.deps, this.text);
    scene.setBuild(room ? room.progress : 1);
    this.group.add(scene.group);
    this.entries.set(area.id, { scene, signature: signatureOf(area, building), lit: 0 });
    this.batcher.reset();
    this.stableFrames = 0;
  }

  private syncOuter(building: BuildingLayout): void {
    if (this.outer?.width === building.width) return;
    if (this.outer) {
      disposeObject(this.outer.group);
      this.outer.group.removeFromParent();
    }
    const parts = new PartCollector();
    buildOuterFacades(parts, building, this.deps.m);
    const group = new Group();
    group.add(parts.build(shadowOf));
    this.group.add(group);
    this.outer = { group, width: building.width };
  }

  private syncTicker(building: BuildingLayout): void {
    if (this.tickerWidth === building.width) return;
    this.tickerWidth = building.width;
    if (this.tickerMesh) {
      this.tickerMesh.geometry.dispose();
      this.tickerMesh.removeFromParent();
    }
    const length = (building.width - 2) * T;
    const mesh = new Mesh(new PlaneGeometry(length, 0.3), this.ticker.material);
    mesh.position.set((1 + (building.width - 2) / 2) * T, 2.5, CORRIDOR_Y * T - 0.03);
    this.tickerMesh = mesh;
    this.group.add(mesh);
  }

  /** Bounds of the areas that can be picked as rooms, with their project ids. */
  projectBoxes(): { projectId: string; areaId: string; box: Box3 }[] {
    const out: { projectId: string; areaId: string; box: Box3 }[] = [];
    for (const [id, entry] of this.entries) {
      const room = this.sim.rooms.byArea(id);
      if (entry.scene.area.kind === 'project' && room && !room.ghost) out.push({ projectId: room.projectId, areaId: id, box: entry.scene.bounds });
    }
    return out;
  }

  /** Bounds of the whiteboard (the task board), when the meeting room is built. */
  whiteboardBox(): Box3 | null {
    for (const entry of this.entries.values()) {
      const box = entry.scene.whiteboardBounds();
      if (box) return box;
    }
    return null;
  }

  areaScene(areaId: string): AreaScene | undefined {
    return this.entries.get(areaId)?.scene;
  }

  update(inputs: AreaInputs): void {
    this.ticker.setText(inputs.tickerText);
    if (this.tickerWidth > 0) this.ticker.scroll(inputs.time, (this.tickerWidth - 2) * T);
    const k = 1 - Math.exp(-inputs.dt * 2.5);
    for (const [id, entry] of this.entries) {
      const area = entry.scene.area;
      const room = this.sim.rooms.byArea(id);
      entry.scene.setBuild(room ? room.progress : 1);
      const always = area.kind !== 'project';
      const goal = always || inputs.occupied(id) ? 1 : 0;
      entry.lit += (goal - entry.lit) * k;
      const frame: AreaFrame = {
        time: inputs.time,
        night: inputs.night,
        lit: room && room.progress < 0.95 ? 0 : entry.lit,
        info: room ? inputs.info(room.projectId) : emptyInfo,
        names: area.kind === 'meeting' ? inputs.namesIn(id) : [],
        taskBoard: inputs.taskBoard,
        desks: area.kind === 'project' ? inputs.desksIn(area) : [],
        elevatorOpen: (i) => this.sim.elevatorOpenness(i),
        refreshScreens: inputs.refreshScreens,
        visible: inputs.isVisible(entry.scene.bounds),
      };
      entry.scene.update(frame);
    }
    this.updateBatching();
  }

  /** Merges settled areas once nothing has changed for a while; any animation or layout change un-merges. */
  private updateBatching(): void {
    const settled = this.queue.length === 0 && [...this.entries.values()].every((e) => e.scene.isBuilt);
    if (!settled) {
      this.batcher.reset();
      this.stableFrames = 0;
      return;
    }
    this.stableFrames++;
    if (this.stableFrames > 90 && (!this.batcher.isActive || this.batcher.inProgress)) {
      this.batcher.step([...this.entries.values()].map((e) => e.scene));
    }
  }

  /** Lit areas with their centre, for the point-light pool. */
  litCentres(): { x: number; z: number; lit: number; width: number }[] {
    const out: { x: number; z: number; lit: number; width: number }[] = [];
    for (const entry of this.entries.values()) {
      const area = entry.scene.area;
      if (entry.lit < 0.05 || area.kind === 'terrace') continue;
      const r = area.rect;
      out.push({ x: (r.x + r.w / 2) * T, z: (r.y + r.h / 2 + 1) * T, lit: entry.lit, width: r.w * T });
    }
    return out;
  }

  dispose(): void {
    for (const e of this.entries.values()) e.scene.dispose();
    this.entries.clear();
    if (this.outer) disposeObject(this.outer.group);
    this.batcher.reset();
    this.ticker.dispose();
    this.group.removeFromParent();
  }
}
