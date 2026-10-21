// The 3D content of one layout area (room, core area, corridor or terrace): merged static shell and props, plus the few
// dynamic objects (screens, elevator doors) that are updated per frame. Rooms animate in and out via group transforms.
import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Vector3,
  type Object3D,
  type Texture,
} from 'three';
import { type WorldText, worldText } from '../../i18n/world/translate';
import type { AreaLayout, BuildingLayout } from '../../layout/types';
import { WALL_ROWS } from '../../layout/constants';
import { TILE_M as T } from '../units';
import { groundQuad, PartCollector, disposeObject } from '../util/parts';
import { buildFurniture, type ScreenQuad } from './furniture';
import { shadowOf, type Materials } from './materials';
import type { Models } from './models';
import { buildAreaShell } from './shell';
import { paintBoard, paintLoungeTv, paintMeetingTv, WorkstationAtlas, type BoardInfo, type DeskState } from './screens';
import { roomInfoKey } from '../../world2d/runtime/boards';
import { taskBoardKey, type TaskBoardSummary } from '../../world/taskBoard';
import { paintTaskBoard } from './taskBoardScreen';
import { paintPlaque } from './plaqueScreen';
import { roomGitKey, type RoomGit } from '../../world/roomGit';
import { buildWallItems, disposeScreens, mountPlaque, type WallScreens } from './wallItems';

export interface SceneDeps {
  m: Materials;
  models: Models;
}

export interface AreaFrame {
  time: number;
  /** 0 day .. 1 night. */
  night: number;
  /** 0..1 how lit the area is at night (occupied rooms and core areas). */
  lit: number;
  info: BoardInfo;
  names: readonly string[];
  /** Summary drawn on the meeting-room whiteboard. */
  taskBoard: TaskBoardSummary;
  desks: readonly DeskState[];
  /** Elevator openness by building elevator index. */
  elevatorOpen: (index: number) => number;
  /** Whether monitor atlases should be redrawn this frame. */
  refreshScreens: boolean;
  /** Whether the area is inside the camera view (off-screen areas skip texture updates). */
  visible: boolean;
}

function screenQuadGeometry(w: number, h: number, uv: [number, number, number, number]): BufferGeometry {
  const [u0, vt0, u1, vt1] = uv;
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new Float32BufferAttribute([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0], 3),
  );
  g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new Float32BufferAttribute([u0, 1 - vt1, u1, 1 - vt1, u1, 1 - vt0, u0, 1 - vt0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export class AreaScene {
  readonly group = new Group();
  readonly bounds = new Box3();
  private readonly shell: Object3D;
  private readonly props: Object3D;
  private readonly dynamic = new Group();
  private readonly screens: WallScreens = { elevators: [], all: [], decor: null };
  private atlas: WorkstationAtlas | null = null;
  private glowMesh: Mesh | null = null;
  private glowMaterial: MeshBasicMaterial | null = null;
  private lastInfoKey = '';
  private lastNamesKey = '';
  private lastTasksKey = '';
  private build = 1;
  private plaqueMounted = false;
  private plaqueMesh: Mesh | null = null;

  private text: WorldText;

  constructor(
    readonly area: AreaLayout,
    building: BuildingLayout,
    private readonly deps: SceneDeps,
    text: WorldText = worldText('pt-BR'),
  ) {
    this.text = text;
    const { m, models } = deps;
    const shellParts = new PartCollector();
    buildAreaShell(shellParts, area, building, m);
    const propParts = new PartCollector();
    const furniture = buildFurniture(propParts, area, m, models);
    buildWallItems(propParts, area, m, this.dynamic, this.screens, area.theme.accent, area.label, text);
    if (furniture.screens.length) this.addMonitors(propParts, furniture.screens);
    this.atlas?.setText(text);
    this.shell = shellParts.build(shadowOf);
    this.props = propParts.build(shadowOf);
    this.group.add(this.shell, this.props, this.dynamic);
    this.addGlow(area);
    const r = area.rect;
    this.bounds.set(new Vector3(r.x * T, 0, r.y * T), new Vector3((r.x + r.w) * T, 3, (r.y + r.h) * T));
  }

  /**
   * Switches the language of the area's texts in place: the decor atlas (pantry menu) is repainted and the boards are
   * redrawn at the next `update`. Meshes, materials and camera are untouched.
   */
  setText(text: WorldText): void {
    if (text.locale === this.text.locale) return;
    this.text = text;
    this.screens.decor?.setText(text);
    this.atlas?.setText(text);
    this.lastInfoKey = '';
    this.lastNamesKey = '';
    this.lastTasksKey = '';
  }

  /** Paints the branch plaque (hanging it the first time), and hides it when the room has no repository to show. */
  private updatePlaque(git: RoomGit | undefined): void {
    const screens = this.screens;
    if (git !== undefined && !this.plaqueMounted) {
      this.plaqueMounted = true;
      const mounted = mountPlaque(this.dynamic, screens, this.area);
      if (mounted !== null) {
        screens.plaque = mounted.screen;
        this.plaqueMesh = mounted.mesh;
      }
    }
    if (this.plaqueMesh === null || screens.plaque === undefined) return;
    this.plaqueMesh.visible = git !== undefined;
    if (git === undefined) return;
    screens.plaque.draw(`${this.text.locale}|${roomGitKey(git)}`, (ctx, w, h) =>
      paintPlaque(ctx, w, h, git, this.text),
    );
  }

  private addMonitors(parts: PartCollector, quads: readonly ScreenQuad[]): void {
    this.atlas = new WorkstationAtlas();
    for (const q of quads) {
      parts.add(screenQuadGeometry(q.w, q.h, WorkstationAtlas.uv(q.desk, q.slot)), this.atlas.material, q.matrix);
    }
  }

  private addGlow(area: AreaLayout): void {
    if (area.kind === 'terrace') return;
    const r = area.rect;
    const mat = new MeshBasicMaterial({
      map: this.deps.m.glow.map as Texture,
      transparent: true,
      depthWrite: false,
      blending: this.deps.m.glow.blending,
      toneMapped: false,
      color: '#ffb866',
      opacity: 0,
    });
    mat.map!.colorSpace = SRGBColorSpace;
    const geo = groundQuad(r.x * T, (r.y + 2) * T, (r.x + r.w) * T, (r.y + r.h) * T, 0.03, 1);
    // the glow texture spans the quad once
    const uv = geo.getAttribute('uv');
    uv.setXY(0, 0, 0);
    uv.setXY(1, 0, 1);
    uv.setXY(2, 1, 1);
    uv.setXY(3, 1, 0);
    const mesh = new Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 2;
    this.glowMesh = mesh;
    this.glowMaterial = mat;
    this.group.add(mesh);
  }

  /** 0 = nothing built, 1 = complete. Walls rise first, then the furniture pops in. */
  setBuild(progress: number): void {
    if (progress === this.build) return;
    this.build = progress;
    const walls = easeOut(clamp01(progress / 0.5));
    const props = easeOutBack(clamp01((progress - 0.4) / 0.6));
    this.shell.scale.set(1, Math.max(0.001, walls), 1);
    this.shell.visible = progress > 0.01;
    this.props.visible = progress > 0.42;
    this.dynamic.visible = progress > 0.9;
    this.props.scale.set(1, Math.max(0.001, props), 1);
  }

  /** Merged static meshes (shell + props); they sit in world space with an identity transform. */
  staticMeshes(): Mesh[] {
    const out: Mesh[] = [];
    for (const group of [this.shell, this.props])
      for (const child of group.children) if ((child as Mesh).isMesh) out.push(child as Mesh);
    return out;
  }

  /** Bounds of the whiteboard (task board) on the north wall, for picking; null when the area has none. */
  whiteboardBounds(): Box3 | null {
    const item = this.area.wallItems.find((wi) => wi.kind === 'whiteboard' && wi.side === 'north');
    if (!item) return null;
    const zFace = (this.area.rect.y + WALL_ROWS) * T;
    return new Box3(new Vector3(item.x * T, 0.9, zFace - 0.1), new Vector3((item.x + item.w) * T, 2.1, zFace + 0.25));
  }

  get isBuilt(): boolean {
    return this.build >= 1;
  }

  update(f: AreaFrame): void {
    const screens = this.screens;
    if (screens.board) {
      const key = `${this.text.locale}|${roomInfoKey(f.info)}`;
      if (key !== this.lastInfoKey) {
        this.lastInfoKey = key;
        screens.board.draw(key, (ctx, w, h) =>
          paintBoard(ctx, w, h, this.area.label, f.info, this.area.theme.accent, this.text),
        );
      }
    }
    if (screens.meetingTv) {
      const key = `${this.text.locale}|${f.names.join('|')}`;
      if (key !== this.lastNamesKey) {
        this.lastNamesKey = key;
        screens.meetingTv.draw(key, (ctx, w, h) => paintMeetingTv(ctx, w, h, f.names, this.text));
      }
    }
    if (screens.whiteboard) {
      const key = `${this.text.locale}|${taskBoardKey(f.taskBoard)}`;
      if (key !== this.lastTasksKey) {
        this.lastTasksKey = key;
        screens.whiteboard.draw(key, (ctx, w, h) => paintTaskBoard(ctx, w, h, f.taskBoard, this.text));
      }
    }
    this.updatePlaque(f.info.git);
    if (screens.loungeTv && f.refreshScreens && f.visible) {
      const t = Math.floor(f.time * 2);
      screens.loungeTv.draw(`lounge${t}`, (ctx, w, h) => paintLoungeTv(ctx, w, h, f.time));
    }
    if (this.atlas && f.refreshScreens && f.visible) this.atlas.update(f.time, f.desks, 1 + f.night * 0.35);
    for (const rig of screens.elevators) {
      const open = f.elevatorOpen(rig.index) * rig.travel;
      rig.left.position.x = rig.leftX - open;
      rig.right.position.x = rig.rightX + open;
    }
    if (this.glowMesh && this.glowMaterial) {
      const o = f.night * f.lit * 0.75;
      this.glowMaterial.opacity = o;
      this.glowMesh.visible = o > 0.01;
    }
  }

  dispose(): void {
    disposeObject(this.group);
    this.atlas?.dispose();
    disposeScreens(this.screens);
    this.glowMaterial?.dispose();
    this.group.removeFromParent();
  }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number): number => {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
