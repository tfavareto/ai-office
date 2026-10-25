// A still image of the 2D office. The picture is drawn from a throwaway simulation of a sanitized snapshot (see
// `world/capture.ts`), with the same renderer the live world uses, minus the overlay (names, bubbles, pills): the
// live scene, camera and caches are never touched.
import type { OfficeSnapshot } from '@ai-office/shared';
import { worldText } from '../i18n/world/translate';
import { TILE } from '../layout/constants';
import { OfficeSim } from '../sim/sim';
import type { WorldOptions } from '../world/api';
import {
  CAPTURE_SEED,
  CAPTURE_SETTLE_SECONDS,
  captureSize,
  captureSnapshot,
  type CaptureOptions,
} from '../world/capture';
import { summarizeTaskBoard } from '../world/taskBoard';
import { Camera, type Point } from './camera';
import { currentFraming, keepInside, overviewFraming, type CaptureFraming, type Size } from './captureFraming';
import { makeCanvas } from './paint/ctx';
import { Renderer, type FrameState } from './renderer';
import { summarizeRoom, withRoomGit, type RoomInfo } from './runtime/boards';
import { renderTicker, tickerFromSnapshot, tickerText } from './runtime/ticker';

/** The live camera, for `mode: 'current'`: what it shows is what the picture shows. */
export interface LiveView {
  zoom: number;
  /** World point at the middle of the free area. */
  center: Point;
  /** Free area (view minus panels), CSS px. */
  free: Size;
}

export interface Capture2DInput {
  snapshot: OfficeSnapshot;
  serverNow: number;
  options: WorldOptions;
  /** 0 day .. 1 night, as the live world shows it. */
  night: number;
  live: LiveView;
  opts: CaptureOptions;
}

/** Animation clock of the picture (LED ticker phase, screens): any value, fixed so the same office looks the same. */
const PICTURE_TIME = 3;
const PICTURE_DT = 1 / 30;

function roomInfos(snapshot: OfficeSnapshot): Map<string, RoomInfo> {
  const rooms = new Map<string, RoomInfo>();
  for (const project of snapshot.projects)
    rooms.set(project.id, summarizeRoom(snapshot.agents.filter((agent) => agent.projectId === project.id)));
  return withRoomGit(rooms, snapshot.projects);
}

function pictureFrame(sim: OfficeSim, cam: Camera, safe: OfficeSnapshot, input: Capture2DInput): FrameState {
  const text = worldText(input.options.locale);
  const stats = tickerFromSnapshot(safe);
  const accountColors = new Map(safe.accounts.map((account) => [account.id, account.color]));
  return {
    sim,
    cam,
    night: input.night,
    time: PICTURE_TIME,
    dt: PICTURE_DT,
    selection: null,
    hover: { agentId: null, roomId: null },
    hoverDesk: null,
    options: { ...input.options, showGit: false, showNames: false, hireEnabled: false },
    roomInfo: roomInfos(safe),
    taskBoard: summarizeTaskBoard(safe.agents, safe.projects),
    agents: new Map(safe.agents.map((agent) => [agent.id, agent])),
    accountColor: (id) => accountColors.get(id) ?? '#8d99ad',
    ticker: renderTicker(tickerText(stats.rooms, stats.agents, stats.working, stats.waiting, stats.shells, text)),
  };
}

function framingFor(input: Capture2DInput, sim: OfficeSim, out: Size): CaptureFraming {
  if (input.opts.mode === 'current') return currentFraming(input.live, out);
  return overviewFraming({ width: sim.building.width * TILE, height: sim.building.height * TILE }, out);
}

/** Scales `source` to `out` with smoothing (the art was drawn at a whole zoom, so it stays crisp). */
function scaleTo(source: HTMLCanvasElement, out: Size): HTMLCanvasElement {
  if (source.width === out.width && source.height === out.height) return source;
  const canvas = makeCanvas(out.width, out.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, source.width, source.height, 0, 0, out.width, out.height);
  return canvas;
}

export function capture2d(input: Capture2DInput): HTMLCanvasElement {
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

  const renderer = new Renderer();
  renderer.sync(sim, input.options.locale);
  const exterior = renderer.layers.exterior;
  const world = exterior ? { x: exterior.x, y: exterior.y, w: exterior.canvas.width, h: exterior.canvas.height } : null;
  const framing = framingFor(input, sim, out);

  const cam = new Camera();
  cam.dpr = 1;
  cam.view = {
    width: framing.render.width,
    height: framing.render.height,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  cam.world = world;
  const center = keepInside(framing, out, world);
  cam.cx = center.x;
  cam.cy = center.y;
  cam.zoom = framing.zoom;
  cam.tz = framing.zoom;

  const canvas = makeCanvas(framing.render.width, framing.render.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('2D canvas context unavailable');
  renderer.draw(ctx, pictureFrame(sim, cam, safe, input));
  return scaleTo(canvas, out);
}
