import type { Agent, OfficeSnapshot } from '@ai-office/shared';
import { Box3, Frustum, Group, Matrix4, Vector3, type Material, type Mesh, type MeshStandardMaterial, type Texture } from 'three';
import { BUILDING_H } from '../layout/constants';
import { clamp } from '../layout/rng';
import { nearestWalkable } from '../layout/grid';
import { OfficeSim } from '../sim/sim';
import {
  DEFAULT_WORLD_OPTIONS, type CameraMode, type HoverInfo, type Selection, type ViewInsets, type WorldApi, type WorldFactoryOptions, type WorldOptions,
} from '../world/api';
import { DayNight } from '../world2d/lighting';
import { summarizeRoom } from '../world2d/runtime/boards';
import { tickerText } from '../world2d/runtime/ticker';
import { CameraRig } from './camera/cameraRig';
import { pickCapsule, targetInSight, type ScreenCapsule, type SightTarget } from './camera/picking';
import { stepWalker, RUN_FACTOR } from './camera/walker';
import { Character3D } from './characters/character3d';
import { FEMALE_MODELS, MALE_MODELS } from './characters/outfits';
import { Crowd } from './characters/crowd';
import { HumanLibrary } from './characters/humanLibrary';
import { PortraitRenderer } from './characters/portrait';
import { CityScene } from './exterior/city';
import { loadCityModels } from './exterior/cityModels';
import { LabelOverlay, type TagItem } from './overlay/labels';
import { paintMinimap } from './overlay/minimap';
import { Stage } from './render/stage';
import { AreaManager } from './scene/areaManager';
import { Materials, loadTextureSets } from './scene/materials';
import { loadModels } from './scene/models';
import type { DeskState } from './scene/screens';
import { TextureLoader } from './scene/textures';
import { SLAB_H, TILE_M, WALL_H } from './units';
import type { AreaLayout } from '../layout/types';
import type { Pose } from '../sim/types';

const DRAG_THRESHOLD = 4;
const MAX_DPR = 2;
const MIN_DPR = 1;
const SCREEN_REFRESH = 0.2;
const POOL_REFRESH = 0.35;
const NAME_MIN_ZOOM = 11;
const FOCUS_ZOOM = 85;
const PAN_SPEED = 14;
const LOOK_SPEED = 1.9;
const SEATED_POSES: ReadonlySet<Pose> = new Set<Pose>(['sit', 'type', 'sleep', 'lean', 'stretch', 'popcorn']);

interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

/** WebGL (three.js) renderer of the office: same simulation and floor plan as the 2D world. */
export class World3D implements WorldApi {
  readonly kind = '3d' as const;
  private readonly stage: Stage;
  private readonly sim = new OfficeSim(20260101);
  private readonly rig = new CameraRig();
  private readonly dayNight = new DayNight();
  private readonly overlay = new LabelOverlay();
  private readonly areas: AreaManager;
  private readonly crowd: Crowd;
  private readonly city: CityScene;
  private readonly portraits: PortraitRenderer;
  private readonly world = new Group();
  private readonly resizeObserver: ResizeObserver;
  private readonly keys = new Set<string>();
  private readonly selectListeners = new Set<(s: Selection) => void>();
  private readonly hoverListeners = new Set<(h: HoverInfo | null) => void>();
  private readonly modeListeners = new Set<(m: CameraMode) => void>();
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly screenA: ScreenPoint = { x: 0, y: 0, depth: 0, visible: true };
  private readonly screenB: ScreenPoint = { x: 0, y: 0, depth: 0, visible: true };

  private options: WorldOptions;
  private insets: ViewInsets;
  private selection: Selection = null;
  private hover: { agentId: string | null; roomId: string | null } = { agentId: null, roomId: null };
  private agents = new Map<string, Agent>();
  private accountColors = new Map<string, string>();
  private roomInfo = new Map<string, ReturnType<typeof summarizeRoom>>();
  private ticker = '';
  private minimap = false;
  private fpHint: string | null = null;
  private fpTarget: string | null = null;

  private raf = 0;
  private last = 0;
  private clock = 0;
  private fps = 60;
  private drawMs = 0;
  private screenTimer = 0;
  private poolTimer = 0;
  private disposed = false;
  private fitted = false;
  private userMoved = false;
  private followPause = 0;
  private lastNight = -1;
  private worldVersion = -1;
  private width = 1;
  private height = 1;
  private pointer: { id: number; x: number; y: number; startX: number; startY: number; dragging: boolean } | null = null;
  private readonly capsules: ScreenCapsule[] = [];

  private constructor(
    private readonly container: HTMLElement,
    opts: WorldFactoryOptions,
    private readonly parts: { materials: Materials; library: HumanLibrary; models: Awaited<ReturnType<typeof loadModels>>; city: Awaited<ReturnType<typeof loadCityModels>> },
  ) {
    this.options = { ...DEFAULT_WORLD_OPTIONS, ...opts.options };
    this.insets = { ...opts.insets };
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;cursor:grab';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Escritório 3D');
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.append(canvas, this.overlay.canvas);
    const query = new URLSearchParams(location.search);
    this.stage = new Stage(canvas, query.get('glcheck') === '1', query.get('aa') !== '0');
    this.areas = new AreaManager({ m: parts.materials, models: parts.models }, this.sim);
    this.crowd = new Crowd(parts.library, this.sim);
    this.city = new CityScene(parts.materials, parts.city);
    this.portraits = new PortraitRenderer(this.stage.renderer, parts.library);
    this.world.add(this.areas.group, this.crowd.group, this.city.group);
    this.stage.scene.add(this.world);
    this.applyOptions();
    this.stage.setPixelRatio(clamp(window.devicePixelRatio || 1, MIN_DPR, MAX_DPR));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.bind(canvas);
    this.resize();
    this.dayNight.update(0);
  }

  /** Loads every asset, builds the static scene, precompiles shaders and starts rendering. */
  static async create(container: HTMLElement, opts: WorldFactoryOptions): Promise<World3D> {
    const loader = new TextureLoader();
    const [sets, models, library, city] = await Promise.all([loadTextureSets(loader), loadModels(), HumanLibrary.load(), loadCityModels()]);
    const mats = new Materials(sets);
    const world = new World3D(container, opts, { materials: mats, library, models, city });
    await world.warmUp();
    world.raf = requestAnimationFrame((t) => world.frame(t));
    return world;
  }

  private async warmUp(): Promise<void> {
    this.areas.sync();
    while (this.areas.pending) {
      await new Promise((r) => setTimeout(r, 0));
      this.areas.sync();
    }
    this.city.setBuildingWidth(this.sim.building.width);
    this.updateWorldBounds();
    this.overview(false);
    this.rig.update(0, true);
    const dummies = [this.parts.library.create(MALE_MODELS[0], '#1f2a44'), this.parts.library.create(FEMALE_MODELS[0], '#5a2f3a')];
    for (const d of dummies) this.stage.scene.add(d.root);
    await this.stage.warmPrograms(this.rig.ortho);
    const materials = new Set<Material>();
    this.stage.scene.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (m) for (const x of Array.isArray(m) ? m : [m]) materials.add(x);
    });
    const textures = new Set<Texture>(this.parts.library.textures());
    for (const m of materials) {
      const std = m as MeshStandardMaterial;
      for (const t of [std.map, std.normalMap, std.roughnessMap, std.emissiveMap]) if (t) textures.add(t);
    }
    await this.stage.uploadTextures(textures);
    await this.stage.initPrograms(materials);
    for (const d of dummies) d.root.removeFromParent();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // WorldApi

  setSnapshot(snapshot: OfficeSnapshot, serverNow: number): void {
    this.sim.setSnapshot(snapshot, serverNow);
    this.agents = new Map(snapshot.agents.map((a) => [a.id, a]));
    this.accountColors = new Map(snapshot.accounts.map((a) => [a.id, a.color]));
    const byProject = new Map<string, Agent[]>();
    for (const agent of snapshot.agents) {
      const list = byProject.get(agent.projectId) ?? [];
      list.push(agent);
      byProject.set(agent.projectId, list);
    }
    this.roomInfo = new Map([...byProject].map(([id, list]) => [id, summarizeRoom(list)]));
    for (const p of snapshot.projects) if (!this.roomInfo.has(p.id)) this.roomInfo.set(p.id, summarizeRoom([]));
    const live = snapshot.agents.filter((a) => a.status !== 'done' && a.status !== 'offline');
    this.ticker = tickerText(
      snapshot.projects.length, live.length, live.filter((a) => a.status === 'working').length, live.filter((a) => a.status === 'waiting').length,
      live.reduce((n, a) => n + a.shells.filter((s) => !s.background).length, 0),
    );
    if (this.selection?.type === 'agent' && !this.agents.has(this.selection.id)) this.selection = null;
  }

  setOptions(options: Partial<WorldOptions>): void {
    this.options = { ...this.options, ...options };
    this.applyOptions();
  }

  private applyOptions(): void {
    this.sim.setOptions({ liveliness: this.options.liveliness, reducedMotion: this.options.reducedMotion, bubbles: this.options.bubbles });
    this.dayNight.setMode(this.options.daylight);
  }

  getOptions(): WorldOptions {
    return this.options;
  }

  setInsets(insets: ViewInsets): void {
    this.insets = { ...insets };
    this.rig.view = { ...this.rig.view, insets: this.insets };
    if (!this.userMoved && this.fitted) this.overview(true);
  }

  select(selection: Selection, opts?: { focus?: boolean }): void {
    this.selection = selection;
    if (opts?.focus) this.focusSelection();
  }

  onSelect(cb: (selection: Selection) => void): () => void {
    this.selectListeners.add(cb);
    return () => this.selectListeners.delete(cb);
  }

  onHover(cb: (hover: HoverInfo | null) => void): () => void {
    this.hoverListeners.add(cb);
    return () => this.hoverListeners.delete(cb);
  }

  private officeBox(): Box3 {
    const b = this.sim.building;
    return new Box3(new Vector3(0, -SLAB_H, 0), new Vector3(b.width * TILE_M, WALL_H, BUILDING_H * TILE_M));
  }

  overview(animate = true): void {
    if (this.rig.mode !== 'overview') this.setCameraMode('overview');
    this.rig.fit(this.officeBox(), !animate || !this.fitted);
    this.fitted = true;
    this.userMoved = false;
  }

  zoomBy(factor: number): void {
    if (factor === 1 || this.rig.mode !== 'overview') return;
    const free = this.freeCenter();
    this.userMoved = true;
    this.rig.zoomAtScreen(factor, free.x, free.y);
  }

  private freeCenter(): { x: number; y: number } {
    const i = this.insets;
    return { x: (i.left + this.width - i.right) / 2, y: (i.top + this.height - i.bottom) / 2 };
  }

  focusSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    this.userMoved = true;
    if (this.rig.mode !== 'overview') return;
    if (sel.type === 'agent') {
      const c = this.sim.character(sel.id);
      if (!c) return;
      this.rig.focusGround(c.x * TILE_M, c.y * TILE_M, Math.max(this.rig.goal.zoom, FOCUS_ZOOM));
      return;
    }
    const box = this.areas.projectBoxes().find((p) => p.projectId === sel.id);
    if (!box) return;
    this.rig.fit(box.box, false, 40);
  }

  cameraModes(): readonly CameraMode[] {
    return ['overview', 'first-person', 'shoulder'];
  }

  cameraMode(): CameraMode {
    return this.rig.mode;
  }

  setCameraMode(mode: CameraMode): void {
    if (mode === this.rig.mode) return;
    if (mode === 'shoulder' && !this.shoulderSubject()) return;
    this.rig.mode = mode;
    this.canvasEl.style.cursor = mode === 'overview' ? 'grab' : 'crosshair';
    this.keys.clear();
    this.fpHint = null;
    this.fpTarget = null;
    if (mode === 'first-person') this.enterFirstPerson();
    if (mode === 'shoulder') {
      this.rig.resetShoulder();
      this.rig.shoulderYaw = 0;
      this.rig.shoulderDistance = 1;
    }
    if (mode === 'overview') this.rig.iso = this.rig.goal;
    for (const cb of this.modeListeners) cb(mode);
  }

  onCameraMode(cb: (mode: CameraMode) => void): () => void {
    this.modeListeners.add(cb);
    return () => this.modeListeners.delete(cb);
  }

  portrait(agentId: string, size: number): string | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    return this.portraits.portrait(agent.id, agent.look, agent.seed, Math.max(32, Math.round(size)));
  }

  stats(): { fps: number; drawMs: number; agents: number; extra?: Record<string, unknown> } {
    const info = this.stage.renderer.info.render;
    return {
      fps: Math.round(this.fps * 10) / 10,
      drawMs: Math.round(this.drawMs * 100) / 100,
      agents: this.sim.characters.length,
      extra: {
        drawCalls: info.calls,
        triangles: info.triangles,
        pixelRatio: this.stage.ratio,
        zoom: Math.round(this.rig.zoom * 10) / 10,
        mode: this.rig.mode,
        rooms: this.sim.roomStates.length,
        night: Math.round(this.dayNight.night * 100) / 100,
        pendingBuilds: this.areas.pending,
        geometries: this.stage.renderer.info.memory.geometries,
        textures: this.stage.renderer.info.memory.textures,
      },
    };
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.stage.resize(this.width, this.height);
    this.overlay.resize(this.width, this.height, this.stage.ratio);
    this.rig.resize(this.width, this.height, this.insets);
    if (this.fitted && !this.userMoved) this.overview(false);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.areas.dispose();
    this.crowd.dispose();
    this.city.dispose();
    this.stage.dispose();
    this.parts.materials.dispose();
    this.parts.library.dispose();
    this.canvasEl.remove();
    this.overlay.canvas.remove();
    this.selectListeners.clear();
    this.hoverListeners.clear();
    this.modeListeners.clear();
  }

  private get canvasEl(): HTMLCanvasElement {
    return this.stage.canvas;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // frame loop

  private frame(now: number): void {
    if (this.disposed) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = this.last ? clamp((now - this.last) / 1000, 0, 0.25) : 1 / 60;
    this.last = now;
    this.clock += dt;
    if (dt > 0) this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    const t0 = performance.now();

    this.sim.advance(dt);
    this.dayNight.update(dt);
    const night = this.dayNight.night;
    if (Math.abs(night - this.lastNight) > 0.002) {
      this.lastNight = night;
      this.stage.setNight(night);
    }
    this.areas.sync();
    this.crowd.sync();
    if (this.sim.layoutVersion !== this.worldVersion) this.onLayoutChanged();
    this.screenTimer += dt;
    const refreshScreens = this.screenTimer >= SCREEN_REFRESH;
    if (refreshScreens) this.screenTimer = 0;
    this.areas.update({
      time: this.clock, dt, night, refreshScreens, tickerText: this.ticker,
      info: (id) => this.roomInfo.get(id) ?? summarizeRoom([]),
      namesIn: (areaId) => this.sim.characters.filter((c) => c.areaId === areaId && c.alpha > 0.5).map((c) => c.name),
      desksIn: (area) => this.desksIn(area),
      isVisible: (box) => this.inView(box),
      occupied: (areaId) => this.sim.characters.some((c) => c.areaId === areaId),
    });
    this.updateCamera(dt);
    const cam = this.rig.active;
    this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    this.crowd.update({
      time: this.clock, dt, accountColor: (id) => this.accountColors.get(id) ?? '#8d99ad',
      selectedId: this.selection?.type === 'agent' ? this.selection.id : null, hoveredId: this.hover.agentId,
      detail: true, still: this.options.reducedMotion,
    });
    this.city.update(this.clock, night);
    this.updatePool(dt);
    this.stage.render(this.rig.active as never, true);
    this.drawOverlay();
    this.drawMs += (performance.now() - t0 - this.drawMs) * 0.1;
  }

  private onLayoutChanged(): void {
    this.worldVersion = this.sim.layoutVersion;
    this.city.setBuildingWidth(this.sim.building.width);
    this.updateWorldBounds();
    if (this.fitted && !this.userMoved && this.rig.mode === 'overview') this.overview(true);
  }

  private readonly frustum = new Frustum();
  private readonly viewProjection = new Matrix4();

  private inView(box: Box3): boolean {
    return this.frustum.intersectsBox(box);
  }

  private updateWorldBounds(): void {
    this.stage.fitSun(this.officeBox());
  }

  private desksIn(area: AreaLayout): DeskState[] {
    const out: DeskState[] = Array.from({ length: 6 }, () => ({ status: 'empty' as const, seed: 0 }));
    const desks = area.spots.filter((s) => s.kind === 'desk');
    for (const c of this.sim.characters) {
      if (c.areaId !== area.id || c.alpha < 0.5 || !SEATED_POSES.has(c.pose)) continue;
      for (const d of desks) {
        if (Math.hypot(c.x - d.x, c.y - d.y) < 0.6 && d.deskIndex !== undefined) out[d.deskIndex] = { status: c.status, seed: c.seed & 0xff };
      }
    }
    return out;
  }

  private updatePool(dt: number): void {
    this.poolTimer += dt;
    if (this.poolTimer >= POOL_REFRESH) {
      this.poolTimer = 0;
      const glow = this.stage.glow;
      const focus = this.rig.mode === 'overview' ? { x: this.rig.iso.target.x, z: this.rig.iso.target.z } : { x: this.rig.walker.x, z: this.rig.walker.z };
      const centres = this.areas.litCentres().sort((a, b) => Math.hypot(a.x - focus.x, a.z - focus.z) - Math.hypot(b.x - focus.x, b.z - focus.z));
      this.stage.pool.forEach((p, i) => {
        const c = centres[i];
        if (!c || glow < 0.02) {
          p.goal = 0;
          return;
        }
        p.light.position.set(c.x, 2.4, c.z);
        p.light.distance = Math.max(9, c.width * 0.62);
        p.goal = 30 * glow * c.lit;
      });
    } else if (this.stage.glow < 0.02) {
      for (const p of this.stage.pool) p.goal = 0;
    }
    this.stage.updatePool(dt);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // camera

  private updateCamera(dt: number): void {
    const rig = this.rig;
    if (rig.mode === 'overview') {
      const pan = this.keyPan();
      if (pan.x || pan.y) {
        const speed = PAN_SPEED * (this.keys.has('shift') ? 2.2 : 1) * dt * Math.max(0.4, 22 / rig.goal.zoom);
        const b = rig.basis;
        // keys move along the screen axes projected on the ground
        const gx = b.right[0] * pan.x * speed - b.up[0] * pan.y * speed;
        const gz = b.right[2] * pan.x * speed - b.up[2] * pan.y * speed;
        rig.goal = { ...rig.goal, target: { x: rig.goal.target.x + gx, z: rig.goal.target.z + gz } };
        this.userMoved = true;
        this.followPause = 2;
      }
      this.followPause = Math.max(0, this.followPause - dt);
      if (this.options.followSelected && this.selection?.type === 'agent' && this.followPause === 0) {
        const c = this.sim.character(this.selection.id);
        if (c) rig.goal = { ...rig.goal, target: { x: c.x * TILE_M, z: c.y * TILE_M } };
      }
    } else if (rig.mode === 'first-person') {
      this.updateFirstPerson(dt);
    } else {
      this.updateShoulder();
    }
    rig.update(dt, this.options.reducedMotion);
  }

  private keyPan(): { x: number; y: number } {
    const k = this.keys;
    return {
      x: (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0),
      y: (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0),
    };
  }

  private enterFirstPerson(): void {
    const grid = this.sim.building.grid;
    const sel = this.selection?.type === 'agent' ? this.sim.character(this.selection.id) : undefined;
    const from = sel ? { x: Math.floor(sel.x) + 1, y: Math.floor(sel.y) + 2 } : { x: 8, y: 9 };
    const tile = nearestWalkable(grid, from, 10) ?? { x: 8, y: 9 };
    const x = (tile.x + 0.5) * TILE_M;
    const z = (tile.y + 0.5) * TILE_M;
    const yaw = sel ? Math.atan2(sel.x * TILE_M - x, sel.y * TILE_M - z) : 0;
    this.rig.walker = { x, z, yaw, pitch: -0.05 };
    this.minimap = false;
  }

  private blocked = (tx: number, tz: number): boolean => {
    const g = this.sim.building.grid;
    return tx < 0 || tz < 0 || tx >= g.width || tz >= g.height || !g.walkable[tz * g.width + tx];
  };

  private updateFirstPerson(dt: number): void {
    const k = this.keys;
    const forward = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    const turn = (k.has('arrowright') ? -1 : 0) + (k.has('arrowleft') ? 1 : 0);
    if (turn) this.rig.look(turn * LOOK_SPEED * dt, 0);
    const speed = 2.3 * (k.has('shift') ? RUN_FACTOR : 1);
    this.rig.walker = stepWalker(this.rig.walker, { forward: k.has('arrowup') || k.has('arrowdown') ? 0 : forward, strafe }, dt, this.blocked, speed);
    if (k.has('arrowup') || k.has('arrowdown')) {
      this.rig.walker = stepWalker(this.rig.walker, { forward: (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0), strafe: 0 }, dt, this.blocked, speed);
    }
    const w = this.rig.walker;
    const dir = this.tmpA.set(Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), Math.cos(w.yaw) * Math.cos(w.pitch));
    const targets: SightTarget[] = [];
    for (const c of this.sim.characters) {
      if (c.alpha < 0.5) continue;
      targets.push({ id: c.agentId, x: c.x * TILE_M, y: 1.35, z: c.y * TILE_M });
    }
    const id = targetInSight({ x: w.x, y: 1.58, z: w.z }, dir, targets);
    this.fpTarget = id;
    const agent = id ? this.agents.get(id) : undefined;
    this.fpHint = agent ? `E · abrir ${agent.name}` : null;
  }

  private shoulderSubject(): { x: number; z: number; yaw: number } | null {
    let c = this.selection?.type === 'agent' ? this.sim.character(this.selection.id) : undefined;
    if (!c) c = this.sim.characters.find((p) => p.alpha > 0.5);
    if (!c) return null;
    const person = this.crowd.get(c.id);
    const yaw = person ? person.root.rotation.y : 0;
    if (!this.selection) this.selection = { type: 'agent', id: c.agentId };
    return { x: c.x * TILE_M, z: c.y * TILE_M, yaw };
  }

  private updateShoulder(): void {
    const subject = this.shoulderSubject();
    if (!subject) {
      this.setCameraMode('overview');
      return;
    }
    const out = { position: new Vector3(), look: new Vector3() };
    this.rig.shoulderFor(subject.x, subject.z, subject.yaw, out);
    this.rig.setShoulder(out.position, out.look);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // overlay

  private drawOverlay(): void {
    const items: TagItem[] = [];
    const first = this.rig.mode === 'first-person';
    const nameZoom = this.rig.mode !== 'overview' || this.rig.zoom >= NAME_MIN_ZOOM;
    const bubbles = new Map(this.sim.bubbles.map((b) => [b.agentId, b]));
    for (const c of this.sim.characters) {
      if (c.alpha < 0.5) continue;
      const head = this.crowd.headTop(c.id, this.tmpA);
      if (!head) continue;
      this.rig.project(head, this.screenA);
      if (!this.screenA.visible || this.screenA.x < -80 || this.screenA.x > this.width + 80 || this.screenA.y < -60 || this.screenA.y > this.height + 40) continue;
      if (this.rig.mode !== 'overview' && this.screenA.depth > 14) continue;
      const agent = this.agents.get(c.agentId);
      const emphasis = (this.selection?.type === 'agent' && this.selection.id === c.agentId) || this.hover.agentId === c.agentId;
      const b = bubbles.get(c.agentId);
      items.push({
        id: c.id, sx: this.screenA.x, sy: this.screenA.y, name: agent?.name ?? c.name, accent: this.accountColors.get(c.accountId) ?? '#8d99ad',
        status: c.status, sub: c.kind === 'sub', emphasis, alert: c.alert && !b,
        bubble: b ? { text: b.text, icon: b.icon, sticky: b.sticky } : null,
      });
    }
    items.sort((p, q) => p.sy - q.sy);
    this.overlay.draw(items, this.options.showNames && nameZoom, first ? this.fpHint : null);
    if (first && this.minimap) {
      this.overlay.drawMinimap((ctx, w, h) =>
        paintMinimap(ctx, w, h, { building: this.sim.building, characters: this.sim.characters, player: this.rig.walker, accent: (c) => this.accountColors.get(c.accountId) ?? '#8d99ad' }),
      );
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // input

  private bind(c: HTMLCanvasElement): void {
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('dblclick', this.onDoubleClick);
    c.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    const p = this.local(e);
    this.pointer = { id: e.pointerId, x: p.x, y: p.y, startX: p.x, startY: p.y, dragging: false };
    this.canvasEl.setPointerCapture(e.pointerId);
    this.canvasEl.focus({ preventScroll: true });
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const ptr = this.pointer;
    if (ptr && ptr.id === e.pointerId) {
      if (!ptr.dragging && Math.hypot(p.x - ptr.startX, p.y - ptr.startY) > DRAG_THRESHOLD) {
        ptr.dragging = true;
        if (this.rig.mode === 'overview') this.canvasEl.style.cursor = 'grabbing';
        this.setHover(null, null, p);
      }
      if (ptr.dragging) this.drag(p.x - ptr.x, p.y - ptr.y);
      ptr.x = p.x;
      ptr.y = p.y;
      return;
    }
    if (this.rig.mode !== 'first-person') this.updateHover(p);
  };

  private drag(dx: number, dy: number): void {
    const rig = this.rig;
    if (rig.mode === 'overview') {
      rig.pan(dx, dy);
      this.userMoved = true;
      this.followPause = 2;
    } else if (rig.mode === 'first-person') {
      rig.look(-dx * 0.0045, -dy * 0.0045);
    } else {
      rig.shoulderYaw = clamp(rig.shoulderYaw - dx * 0.006, -Math.PI, Math.PI);
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    const ptr = this.pointer;
    if (!ptr || ptr.id !== e.pointerId) return;
    this.pointer = null;
    this.canvasEl.style.cursor = this.rig.mode === 'overview' ? 'grab' : 'crosshair';
    if (!ptr.dragging && e.type === 'pointerup' && this.rig.mode !== 'first-person') this.click(this.local(e));
  };

  private onPointerLeave = (): void => {
    if (!this.pointer) this.setHover(null, null, null);
  };

  private pickAt(p: { x: number; y: number }): Selection {
    this.capsules.length = 0;
    for (const c of this.sim.characters) {
      if (c.alpha < 0.5) continue;
      const person = this.crowd.get(c.id);
      if (!person || !person.root.visible) continue;
      this.tmpB.set(c.x * TILE_M, 0.05, c.y * TILE_M);
      this.rig.project(this.tmpB, this.screenB);
      const head = person.headTop(this.tmpA);
      this.rig.project(head, this.screenA);
      const height = Math.hypot(this.screenA.x - this.screenB.x, this.screenA.y - this.screenB.y);
      this.capsules.push({ id: c.agentId, ax: this.screenB.x, ay: this.screenB.y, bx: this.screenA.x, by: this.screenA.y + height * 0.05, radius: clamp(height * 0.2, 9, 46), depth: this.screenB.depth });
    }
    const agent = pickCapsule(this.capsules, p.x, p.y);
    if (agent) return { type: 'agent', id: agent };
    const ray = this.rig.rayAt(p.x, p.y).ray;
    let best: { id: string; d: number } | null = null;
    for (const room of this.areas.projectBoxes()) {
      const hit = ray.intersectBox(room.box, this.tmpA);
      if (!hit) continue;
      const d = hit.distanceTo(ray.origin);
      if (!best || d < best.d) best = { id: room.projectId, d };
    }
    return best ? { type: 'room', id: best.id } : null;
  }

  private click(p: { x: number; y: number }): void {
    const picked = this.pickAt(p);
    this.selection = picked;
    for (const cb of this.selectListeners) cb(picked);
  }

  private onDoubleClick = (e: MouseEvent): void => {
    if (this.rig.mode !== 'overview') return;
    const picked = this.pickAt(this.local(e));
    if (!picked) return;
    this.selection = picked;
    for (const cb of this.selectListeners) cb(picked);
    this.focusSelection();
  };

  private updateHover(p: { x: number; y: number }): void {
    const picked = this.pickAt(p);
    const agentId = picked?.type === 'agent' ? picked.id : null;
    let roomId = picked?.type === 'room' ? picked.id : null;
    if (agentId) {
      const c = this.sim.character(agentId);
      const area = c?.areaId ? this.sim.building.areas.find((a) => a.id === c.areaId) : undefined;
      roomId = area?.projectId ?? null;
    }
    this.setHover(agentId, roomId, p);
    this.canvasEl.style.cursor = picked ? 'pointer' : this.rig.mode === 'overview' ? 'grab' : 'crosshair';
  }

  private setHover(agentId: string | null, roomId: string | null, p: { x: number; y: number } | null): void {
    const changed = agentId !== this.hover.agentId || roomId !== this.hover.roomId;
    this.hover = { agentId, roomId };
    if (!changed && !(p && (agentId || roomId))) return;
    const info: HoverInfo | null = p && (agentId || roomId) ? { agentId, roomId, x: p.x, y: p.y } : null;
    for (const cb of this.hoverListeners) cb(info);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const delta = e.deltaY * unit * (e.ctrlKey ? 4 : 1);
    if (this.rig.mode === 'overview') {
      const p = this.local(e);
      this.userMoved = true;
      this.rig.zoomAtScreen(Math.exp(-delta * 0.0015), p.x, p.y);
    } else if (this.rig.mode === 'shoulder') {
      this.rig.shoulderDistance = clamp(this.rig.shoulderDistance * Math.exp(delta * 0.001), 0.5, 3);
    }
  };

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  /** Capture phase: first-person claims E / M / Esc before the app's global shortcuts see them. */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || this.typing(e)) return;
    const key = e.key.toLowerCase();
    const mode = this.rig.mode;
    if (mode !== 'overview') {
      if (key === 'escape') {
        e.stopImmediatePropagation();
        this.setCameraMode('overview');
        return;
      }
      if (mode === 'first-person' && key === 'm' && !e.repeat) {
        e.stopImmediatePropagation();
        this.minimap = !this.minimap;
        return;
      }
      if (mode === 'first-person' && key === 'e' && !e.repeat) {
        e.stopImmediatePropagation();
        if (this.fpTarget) {
          this.selection = { type: 'agent', id: this.fpTarget };
          for (const cb of this.selectListeners) cb(this.selection);
        }
        return;
      }
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      this.keys.add(key);
      if (key.startsWith('arrow')) e.preventDefault();
    } else if (key === 'shift') this.keys.add('shift');
    else if (mode === 'overview' && (key === '+' || key === '=') && !e.repeat) this.zoomBy(1.25);
    else if (mode === 'overview' && key === '-' && !e.repeat) this.zoomBy(1 / 1.25);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onBlur = (): void => {
    this.keys.clear();
  };
}

export type { Character3D };
