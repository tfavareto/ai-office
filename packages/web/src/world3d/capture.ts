// A still image of the 3D office. Like the 2D capture it is built from a throwaway simulation of a sanitized snapshot:
// a second set of rooms and people (same shared materials, models and lights) takes the place of the live ones for the
// time of one render, so no project name, task or branch is ever painted on a sign or a board in the picture.
import { Box3, Vector3, type Group, type Object3D } from 'three';
import type { OfficeSnapshot } from '@ai-office/shared';
import { worldText } from '../i18n/world/translate';
import { BUILDING_H } from '../layout/constants';
import type { AreaLayout } from '../layout/types';
import { OfficeSim } from '../sim/sim';
import type { Pose } from '../sim/types';
import type { WorldOptions } from '../world/api';
import {
  CAPTURE_SEED,
  CAPTURE_SETTLE_SECONDS,
  captureSize,
  captureSnapshot,
  type CaptureOptions,
} from '../world/capture';
import { summarizeTaskBoard } from '../world/taskBoard';
import { summarizeRoom, withRoomGit } from '../world2d/runtime/boards';
import { tickerFromSnapshot, tickerText } from '../world2d/runtime/ticker';
import { currentIso, overviewIso, type Size } from './camera/captureFraming';
import { CameraRig } from './camera/cameraRig';
import type { IsoState } from './camera/isoCamera';
import { Crowd } from './characters/crowd';
import type { HumanLibrary } from './characters/humanLibrary';
import { renderStill } from './render/stillRender';
import type { Stage } from './render/stage';
import { AreaManager } from './scene/areaManager';
import { evolutionOf } from '../world/evolution';
import type { SceneDeps } from './scene/areaScene';
import type { BoardInfo, DeskState } from './scene/screens';
import { SLAB_H, TILE_M, WALL_H } from './units';

const SEATED_POSES: ReadonlySet<Pose> = new Set<Pose>(['sit', 'type', 'sleep', 'lean', 'stretch', 'popcorn']);
/** The people ease into their poses: a few simulated steps before the picture. */
const POSE_STEPS = 24;
const POSE_DT = 0.1;
const PICTURE_TIME = 3;
/** Large enough for the "lit" easing of the rooms to reach its end. */
const LIGHT_DT = 10;
const POOL_LIGHT_LEVEL = 30;
const POOL_MIN_DISTANCE = 9;
const POOL_DISTANCE_RATIO = 0.62;
const POOL_HEIGHT = 2.4;
const GLOW_ON = 0.02;

/** What the live world lends to a capture. */
export interface Capture3DInput {
  stage: Stage;
  deps: SceneDeps;
  library: HumanLibrary;
  /** The live scene graph the capture groups are added to, and the live groups hidden while it renders. */
  host: Group;
  live: Object3D[];
  snapshot: OfficeSnapshot;
  serverNow: number;
  options: WorldOptions;
  night: number;
  /** Live overview camera, or null when the live camera is not the overview (then the capture frames the office). */
  liveView: { iso: IsoState; free: Size } | null;
  /** Width (tiles) of the live building, to put the city and the sun back after a differing capture. */
  liveWidth: number;
  /** Rebuilds the city for a building width. */
  setCityWidth: (widthTiles: number) => void;
  opts: CaptureOptions;
}

function officeBox(widthTiles: number): Box3 {
  return new Box3(new Vector3(0, -SLAB_H, 0), new Vector3(widthTiles * TILE_M, WALL_H, BUILDING_H * TILE_M));
}

function desksIn(sim: OfficeSim, area: AreaLayout): DeskState[] {
  const out: DeskState[] = Array.from({ length: 6 }, () => ({ status: 'empty' as const, seed: 0 }));
  const desks = area.spots.filter((s) => s.kind === 'desk');
  for (const c of sim.characters) {
    if (c.areaId !== area.id || c.alpha < 0.5 || !SEATED_POSES.has(c.pose)) continue;
    for (const d of desks) {
      if (Math.hypot(c.x - d.x, c.y - d.y) < 0.6 && d.deskIndex !== undefined)
        out[d.deskIndex] = { status: c.status, seed: c.seed & 0xff };
    }
  }
  return out;
}

function boardInfos(snapshot: OfficeSnapshot): Map<string, BoardInfo> {
  const rooms = new Map<string, BoardInfo>();
  for (const project of snapshot.projects)
    rooms.set(project.id, summarizeRoom(snapshot.agents.filter((agent) => agent.projectId === project.id)));
  return withRoomGit(rooms, snapshot.projects);
}

/** Point lights of the capture's lit rooms, in place of the live ones, for the time of the render. */
function lightRooms(stage: Stage, areas: AreaManager, target: { x: number; z: number }): () => void {
  const saved = stage.pool.map((p) => ({
    position: p.light.position.clone(),
    distance: p.light.distance,
    intensity: p.light.intensity,
    visible: p.light.visible,
  }));
  const glow = stage.glow;
  const centres = areas
    .litCentres()
    .sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z));
  stage.pool.forEach((p, i) => {
    const c = centres[i];
    const on = c !== undefined && glow > GLOW_ON;
    p.light.visible = on;
    p.light.intensity = on ? POOL_LIGHT_LEVEL * glow * c.lit : 0;
    if (c) {
      p.light.position.set(c.x, POOL_HEIGHT, c.z);
      p.light.distance = Math.max(POOL_MIN_DISTANCE, c.width * POOL_DISTANCE_RATIO);
    }
  });
  return () =>
    stage.pool.forEach((p, i) => {
      const s = saved[i];
      if (!s) return;
      p.light.position.copy(s.position);
      p.light.distance = s.distance;
      p.light.intensity = s.intensity;
      p.light.visible = s.visible;
    });
}

export function capture3d(input: Capture3DInput): HTMLCanvasElement {
  const out = captureSize(input.opts);
  const text = worldText(input.options.locale);
  const safe = captureSnapshot(input.snapshot, {
    showProjectNames: input.opts.showProjectNames === true,
    roomLabel: (n) => text.t('room.generic', { n }),
  });
  const sim = new OfficeSim(CAPTURE_SEED);
  sim.setOptions({ bubbles: 'none', reducedMotion: true, liveliness: input.options.liveliness });
  sim.setSnapshot(safe, input.serverNow);
  sim.runFor(CAPTURE_SETTLE_SECONDS);

  const areas = new AreaManager(input.deps, sim);
  areas.setText(text);
  areas.setEvolution(evolutionOf(safe.progress, input.options.evolution));
  areas.sync(true);
  const crowd = new Crowd(input.library, sim);
  crowd.sync();

  const infos = boardInfos(safe);
  const stats = tickerFromSnapshot(safe);
  const taskBoard = summarizeTaskBoard(safe.agents, safe.projects);
  const colors = new Map(safe.accounts.map((a) => [a.id, a.color]));
  const empty: BoardInfo = { agents: 0, working: 0, waiting: 0, tasksTotal: 0, tasksDone: 0, current: null };
  const frame = (time: number, dt: number): void => {
    areas.update({
      time,
      dt,
      night: input.night,
      refreshScreens: true,
      tickerText: tickerText(stats.rooms, stats.agents, stats.working, stats.waiting, stats.shells, text),
      info: (id) => infos.get(id) ?? empty,
      taskBoard,
      namesIn: (areaId) => sim.characters.filter((c) => c.areaId === areaId && c.alpha > 0.5).map((c) => c.name),
      desksIn: (area) => desksIn(sim, area),
      isVisible: () => true,
      still: true,
      occupied: (areaId) => sim.characters.some((c) => c.areaId === areaId),
    });
    crowd.update({
      time,
      dt,
      accountColor: (id) => colors.get(id) ?? '#8d99ad',
      selectedId: null,
      hoveredId: null,
      still: true,
    });
  };
  frame(PICTURE_TIME, LIGHT_DT);
  for (let i = 0; i < POSE_STEPS; i++) frame(PICTURE_TIME + i * POSE_DT, POSE_DT);

  const width = sim.building.width;
  const box = officeBox(width);
  const rig = new CameraRig();
  rig.resize(out.width, out.height, { top: 0, right: 0, bottom: 0, left: 0 });
  const iso =
    input.opts.mode === 'current' && input.liveView
      ? currentIso(input.liveView, out)
      : overviewIso(box, rig.basis, out);
  rig.iso = iso;
  rig.goal = iso;
  rig.update(0, true);

  const { stage, host } = input;
  const hidden = input.live.map((object) => object.visible);
  for (const object of input.live) object.visible = false;
  host.add(areas.group, crowd.group);
  if (width !== input.liveWidth) {
    input.setCityWidth(width);
    stage.fitSun(box);
  }
  const restoreLights = lightRooms(stage, areas, iso.target);
  stage.renderer.shadowMap.needsUpdate = true;
  try {
    return renderStill(stage, rig.ortho, out.width, out.height, input.night);
  } finally {
    restoreLights();
    host.remove(areas.group, crowd.group);
    crowd.dispose();
    areas.dispose();
    input.live.forEach((object, i) => (object.visible = hidden[i] ?? true));
    if (width !== input.liveWidth) {
      input.setCityWidth(input.liveWidth);
      stage.fitSun(officeBox(input.liveWidth));
    }
    stage.renderer.shadowMap.needsUpdate = true;
  }
}
