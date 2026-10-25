import type { Agent, Locale } from '@ai-office/shared';
import { worldText } from '../i18n/world/translate';
import { TILE } from '../layout/constants';
import type { AreaLayout, Rect } from '../layout/types';
import type { OfficeSim } from '../sim/sim';
import type { Selection, WorldOptions } from '../world/api';
import { blit, intersects } from './blit';
import { Camera } from './camera';
import { type Look, lookFor } from './chars/looks';
import type { AreaCanvas } from './layers/areaLayer';
import { LayerCache } from './layers/cache';
import { skyColors } from './lighting';
import { type Ctx, context2d, makeCanvas } from './paint/ctx';
import { DESK_SCREENS } from './paint/furnOffice';
import { type RoomInfo, renderBoard, renderMeetingTv, renderTaskBoard, roomInfoKey } from './runtime/boards';
import { taskBoardKey, type TaskBoardSummary } from '../world/taskBoard';
import { roomGitKey } from '../world/roomGit';
import { ITEM_Y } from './paint/wallitems';
import { PLAQUE_W, renderPlaque } from './runtime/plaque';
import { type CarDraw, Traffic } from './runtime/cars';
import { SCREEN_H, SCREEN_W, desksScreens, screenSprite } from './runtime/screens';
import { type TickerStrip } from './runtime/ticker';
import { drawElevators } from './dynamic';
import { drawAreaAnimated } from './animation';
import { BASE_EVOLUTION, type Evolution } from '../world/evolution';
import { OfficePet } from '../world/pet';
import { drawAquariumLife, drawPet } from './runtime/decorAnim';
import { drawLighting } from './night';
import { drawCharacters } from './characters';
import { ConfettiSystem } from './fx/confetti';
import { ballAt } from '../sim/pingpong';

import type { DeskTarget } from '../sim/desks';

export interface FrameState {
  sim: OfficeSim;
  cam: Camera;
  night: number;
  /** Real seconds since start (animation clock). */
  time: number;
  dt: number;
  selection: Selection;
  hover: { agentId: string | null; roomId: string | null };
  /** The empty desk under the pointer (while the page can hire). */
  hoverDesk: DeskTarget | null;
  options: WorldOptions;
  roomInfo: ReadonlyMap<string, RoomInfo>;
  taskBoard: TaskBoardSummary;
  agents: ReadonlyMap<string, Agent>;
  accountColor: (accountId: string) => string;
  ticker: TickerStrip | null;
}

/** y (px from the room's top) of the branch plaque: right under the 11 px sign. */
const PLAQUE_Y = ITEM_Y + 12;

interface DeskRef {
  spotId: string;
  /** World px of the first screen. */
  x: number;
  y: number;
}

interface BoardCache {
  key: string;
  canvas: HTMLCanvasElement;
}

/** Draws one frame of the 2D world from the cached layers and the simulation. */
export class Renderer {
  readonly layers = new LayerCache();
  readonly traffic = new Traffic();
  readonly confetti = new ConfettiSystem();
  private cars: CarDraw[] = [];
  private lit = new Map<string, number>();
  private boards = new Map<string, BoardCache>();
  private desks = new Map<string, DeskRef[]>();
  private skyDay: HTMLCanvasElement;
  private skyNight: HTMLCanvasElement;
  private seenVersion = -1;
  private trafficKey = '';
  private lookCache = new Map<string, Look>();
  private evolution: Evolution = BASE_EVOLUTION;
  private readonly pet = new OfficePet();

  constructor() {
    this.skyDay = this.makeSky(false);
    this.skyNight = this.makeSky(true);
  }

  private makeSky(night: boolean): HTMLCanvasElement {
    const canvas = makeCanvas(32, 8);
    const ctx = context2d(canvas);
    const [top, bottom] = skyColors(night ? 1 : 0);
    const grad = ctx.createLinearGradient(0, 0, 0, 8);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 8);
    if (night) {
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = i % 3 === 0 ? '#ffe9b0' : '#9fb4e8';
        ctx.fillRect((i * 11 + 3) % 32, (i * 5) % 6, 1, 1);
      }
      ctx.fillStyle = 'rgba(255,214,150,0.9)';
      for (let i = 0; i < 5; i++) ctx.fillRect((i * 7 + 2) % 30, 6, 2, 2);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(4, 2, 7, 1);
      ctx.fillRect(6, 1, 4, 1);
      ctx.fillRect(20, 4, 8, 1);
      ctx.fillRect(22, 3, 4, 1);
    }
    return canvas;
  }

  lookOf(agent: Agent): Look {
    const key = `${agent.id}|${agent.seed}|${agent.look}|${agent.kind}`;
    let look = this.lookCache.get(key);
    if (!look) {
      look = lookFor(agent.seed, agent.look, agent.kind === 'sub');
      this.lookCache.set(key, look);
    }
    return look;
  }

  /** The decoration the office has unlocked; the static layers that hold it are redrawn on the next sync. */
  setEvolution(evolution: Evolution): void {
    this.evolution = evolution;
  }

  evolutionNow(): Evolution {
    return this.evolution;
  }

  /** Make sure static layers match the simulation's layout. */
  sync(sim: OfficeSim, locale: Locale = 'pt-BR'): void {
    this.layers.sync(sim.building, locale, this.evolution);
    if (this.layers.version !== this.seenVersion) {
      this.seenVersion = this.layers.version;
      this.refreshDynamic();
    }
    const ex = this.layers.exterior;
    if (ex && ex.key !== this.trafficKey) {
      this.trafficKey = ex.key;
      this.traffic.rebuild(ex.layout);
    }
  }

  private refreshDynamic(): void {
    this.desks.clear();
    for (const ac of this.layers.areas.values()) {
      const list: DeskRef[] = [];
      for (const spot of ac.area.spots) {
        if (spot.kind !== 'desk' || spot.deskIndex === undefined) continue;
        const desk = ac.area.furniture.find((f) => f.kind === 'desk' && f.variant === spot.deskIndex);
        if (desk) list.push({ spotId: spot.id, x: desk.x * TILE, y: desk.y * TILE });
      }
      if (list.length) this.desks.set(ac.area.id, list);
    }
  }

  lightOf(areaId: string): number {
    return this.lit.get(areaId) ?? 0;
  }

  draw(ctx: CanvasRenderingContext2D, s: FrameState): void {
    const { cam } = s;
    const dpr = cam.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Below one device pixel per art pixel nearest-neighbour would drop rows/columns: average them instead.
    ctx.imageSmoothingEnabled = cam.zoom * dpr < 1;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#12151c';
    ctx.fillRect(0, 0, cam.view.width * dpr, cam.view.height * dpr);
    this.sync(s.sim, s.options.locale);

    const scale = cam.zoom * dpr;
    const c = cam.snapped();
    const tx = Math.round((cam.view.width / 2) * dpr - c.x * scale);
    const ty = Math.round((cam.view.height / 2) * dpr - c.y * scale);
    ctx.setTransform(scale, 0, 0, scale, tx, ty);
    const vis = cam.visibleWorld(24);

    this.updateLights(s);
    this.drawExterior(ctx, s, vis);
    const ordered = this.layers.ordered();
    this.drawGrounds(ctx, s, ordered, vis);
    this.drawFurniture(ctx, s, ordered, vis);
    this.drawDynamic(ctx, s, ordered, vis);
    this.drawDecorLife(ctx, s, ordered, vis);
    drawCharacters(ctx, this, s, ordered, vis);
    if (s.night > 0.004) drawLighting(ctx, this, s, ordered, vis, this.cars);
    this.confetti.draw(ctx, vis, cam.zoom);
  }

  // ---------------------------------------------------------------------------------------------------------------

  private updateLights(s: FrameState): void {
    const counts = new Map<string, number>();
    for (const ch of s.sim.characters) {
      if (ch.areaId && ch.alpha > 0.3) counts.set(ch.areaId, (counts.get(ch.areaId) ?? 0) + 1);
    }
    for (const area of s.sim.building.areas) {
      const projectInfo = area.projectId ? s.roomInfo.get(area.projectId) : undefined;
      const room = s.sim.rooms.byArea(area.id);
      // every common area stays lit at night (the floor is a working office); project rooms follow their people
      const alwaysLit = !area.projectId && area.kind !== 'terrace';
      const target =
        alwaysLit || (counts.get(area.id) ?? 0) > 0 || (!!projectInfo && projectInfo.agents > 0 && !room?.ghost)
          ? 1
          : 0;
      const current = this.lit.get(area.id) ?? target;
      const next = current + (target - current) * (1 - Math.exp(-s.dt * 2.2));
      this.lit.set(area.id, Math.abs(next - target) < 0.004 ? target : next);
    }
    for (const id of [...this.lit.keys()]) if (!s.sim.building.areas.some((a) => a.id === id)) this.lit.delete(id);
  }

  private drawExterior(ctx: Ctx, s: FrameState, vis: Rect): void {
    const ex = this.layers.exterior;
    if (!ex) return;
    blit(ctx, ex.canvas, ex.x, ex.y, vis);
    this.traffic.draw(s.time, this.cars);
    for (const car of this.cars) {
      if (
        car.x > vis.x + vis.w ||
        car.x + car.sprite.width < vis.x ||
        car.y > vis.y + vis.h ||
        car.y + car.sprite.height < vis.y
      )
        continue;
      ctx.drawImage(car.sprite, Math.round(car.x), Math.round(car.y));
    }
  }

  private drawGrounds(ctx: Ctx, s: FrameState, ordered: AreaCanvas[], vis: Rect): void {
    const night = s.night;
    for (const ac of ordered) {
      if (!intersects(ac.x, ac.y, ac.w, ac.h, vis)) continue;
      this.drawPanes(ctx, ac, night);
    }
    const cap = this.layers.endCap;
    if (cap) blit(ctx, cap, (s.sim.building.width - 1) * TILE, 0, vis);
    for (const ac of ordered) {
      if (!intersects(ac.x, ac.y, ac.w, ac.h, vis)) continue;
      const room = s.sim.rooms.byArea(ac.area.id);
      if (room && room.progress < 1) drawAreaAnimated(ctx, ac, room.progress, s.time, vis);
      else blit(ctx, ac.ground, ac.x, ac.y, vis);
    }
  }

  private drawPanes(ctx: Ctx, ac: AreaCanvas, night: number): void {
    for (const pane of ac.panes) {
      ctx.globalAlpha = 1;
      ctx.drawImage(this.skyDay, pane.x, pane.y, pane.w, pane.h);
      if (night > 0.01) {
        ctx.globalAlpha = night;
        ctx.drawImage(this.skyNight, pane.x, pane.y, pane.w, pane.h);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawFurniture(ctx: Ctx, s: FrameState, ordered: AreaCanvas[], vis: Rect): void {
    for (const ac of ordered) {
      if (!intersects(ac.x, ac.y - ac.furnMargin, ac.w, ac.h + ac.furnMargin, vis)) continue;
      const room = s.sim.rooms.byArea(ac.area.id);
      if (room && room.progress < 1) continue;
      blit(ctx, ac.furn, ac.x, ac.y - ac.furnMargin, vis);
    }
  }

  /** The fish of the aquarium and the cat: drawn before the people, so anyone passing by is in front of them. */
  private drawDecorLife(ctx: Ctx, s: FrameState, ordered: AreaCanvas[], vis: Rect): void {
    const evolution = this.evolution;
    if (evolution.decor.size === 0) return;
    const still = s.options.reducedMotion;
    for (const ac of ordered) {
      if (!intersects(ac.x, ac.y - ac.furnMargin, ac.w, ac.h + ac.furnMargin, vis)) continue;
      drawAquariumLife(ctx, ac, evolution, s.time, still);
    }
    if (!evolution.decor.has('pet')) return;
    this.pet.sync(s.sim.building);
    this.pet.update(s.dt, still);
    const pose = this.pet.pose;
    if (
      pose.x * TILE > vis.x - 24 &&
      pose.x * TILE < vis.x + vis.w + 24 &&
      pose.y * TILE > vis.y - 24 &&
      pose.y * TILE < vis.y + vis.h + 24
    )
      drawPet(ctx, pose);
  }

  private roomInfoOf(s: FrameState, area: AreaLayout): RoomInfo | undefined {
    return area.projectId ? s.roomInfo.get(area.projectId) : undefined;
  }

  private boardFor(key: string, build: () => HTMLCanvasElement, version: string): HTMLCanvasElement {
    const hit = this.boards.get(key);
    if (hit && hit.key === version) return hit.canvas;
    const canvas = build();
    this.boards.set(key, { key: version, canvas });
    return canvas;
  }

  private drawDynamic(ctx: Ctx, s: FrameState, ordered: AreaCanvas[], vis: Rect): void {
    const frameBase = Math.floor(s.time * 4);
    for (const ac of ordered) {
      if (!intersects(ac.x, ac.y - ac.furnMargin, ac.w, ac.h + ac.furnMargin, vis)) continue;
      const room = s.sim.rooms.byArea(ac.area.id);
      if (room && room.progress < 1) continue;
      const desks = this.desks.get(ac.area.id);
      if (desks) this.drawDesks(ctx, s, desks, frameBase);
      if (ac.area.kind === 'meeting' && ac.area.ledge) this.drawFrost(ctx, ac, this.lightOf(ac.area.id));
      for (const screen of ac.screens) this.drawWallScreen(ctx, s, ac, screen, frameBase);
      this.drawPlaque(ctx, s, ac);
    }
    drawElevators(ctx, s.sim, vis);
    this.drawPingPong(ctx, s, vis);
    this.drawTicker(ctx, s, vis);
  }

  /** The ping-pong ball: resting on the table, or flying between the players during a rally. */
  private drawPingPong(ctx: Ctx, s: FrameState, vis: Rect): void {
    for (const table of s.sim.pingPongTables()) {
      const ball = ballAt(table, s.time);
      const px = Math.round(ball.x * TILE);
      const py = Math.round(ball.y * TILE);
      if (px < vis.x - 4 || px > vis.x + vis.w + 4 || py < vis.y - 24 || py > vis.y + vis.h + 4) continue;
      ctx.fillStyle = 'rgba(8,16,40,0.35)';
      ctx.fillRect(px - 1, py + 1, 3, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px - 1, py - Math.round(ball.z * TILE) - 1, 2, 2);
    }
  }

  /** The branch plaque under a project room's sign (nothing for a folder that is not a repository). */
  private drawPlaque(ctx: Ctx, s: FrameState, ac: AreaCanvas): void {
    const git = s.options.showGit ? this.roomInfoOf(s, ac.area)?.git : undefined;
    const sign = ac.area.wallItems.find((item) => item.kind === 'sign' && item.side === 'north');
    if (git === undefined || sign === undefined) return;
    const canvas = this.boardFor(`${ac.area.id}:plaque`, () => renderPlaque(git), roomGitKey(git));
    ctx.drawImage(canvas, sign.x * TILE + Math.floor((sign.w * TILE - PLAQUE_W) / 2), ac.area.rect.y * TILE + PLAQUE_Y);
  }

  /** The meeting-room glass wall frosts over while people are inside. */
  private drawFrost(ctx: Ctx, ac: AreaCanvas, amount: number): void {
    if (amount < 0.02 || !ac.area.ledge) return;
    ctx.fillStyle = `rgba(244,249,252,${(0.6 * amount).toFixed(3)})`;
    ctx.fillRect(ac.area.rect.x * TILE, ac.area.ledge.y * TILE + 6, ac.area.rect.w * TILE, 10);
  }

  private drawDesks(ctx: Ctx, s: FrameState, desks: DeskRef[], frameBase: number): void {
    for (const desk of desks) {
      const owner = s.sim.spots.claimant(desk.spotId);
      const actor = owner ? s.sim.character(owner) : undefined;
      const spot = s.sim.spots.get(desk.spotId);
      const here = actor && spot ? Math.hypot(actor.x - spot.x, actor.y - spot.y) < 2.2 && !actor.moving : false;
      const agent = actor?.agent;
      const kinds = desksScreens(
        here && agent ? agent.status : actor ? 'idle' : null,
        agent?.activity?.kind,
        !!agent?.shells.some((x) => !x.background),
      );
      for (let i = 0; i < DESK_SCREENS.length; i++) {
        const r = DESK_SCREENS[i];
        ctx.drawImage(screenSprite(kinds[i], frameBase + i * 2), desk.x + r.x, desk.y + r.y, SCREEN_W, SCREEN_H);
      }
    }
  }

  private drawWallScreen(
    ctx: Ctx,
    s: FrameState,
    ac: AreaCanvas,
    screen: AreaCanvas['screens'][number],
    frameBase: number,
  ): void {
    const area = ac.area;
    if (screen.kind === 'board') {
      const info = this.roomInfoOf(s, area);
      if (!info) return;
      const text = worldText(s.options.locale);
      const version = `${roomInfoKey(info)}|${area.theme.accent}|${text.locale}`;
      const canvas = this.boardFor(
        `${area.id}:board`,
        () => renderBoard(screen.w, screen.h, info, area.theme.accent, text),
        version,
      );
      ctx.drawImage(canvas, screen.x, screen.y);
      return;
    }
    if (screen.kind === 'taskboard') {
      const text = worldText(s.options.locale);
      const canvas = this.boardFor(
        'meeting:tasks',
        () => renderTaskBoard(screen.w, screen.h, s.taskBoard, text),
        `${text.locale}|${taskBoardKey(s.taskBoard)}`,
      );
      ctx.drawImage(canvas, screen.x, screen.y);
      return;
    }
    if (area.kind === 'meeting') {
      const names = s.sim.characters.filter((c) => c.areaId === 'meeting' && c.alpha > 0.5).map((c) => c.name);
      const text = worldText(s.options.locale);
      const canvas = this.boardFor(
        'meeting:tv',
        () => renderMeetingTv(screen.w, screen.h, names, text),
        `${text.locale}|${names.join('|')}`,
      );
      ctx.drawImage(canvas, screen.x, screen.y);
      return;
    }
    // lounge TV: colour bars with a moving highlight
    const bars = ['#e0795a', '#f2c46d', '#4f9559', '#27c6cc', '#4f86f7', '#bb9af7'];
    const bw = Math.floor(screen.w / bars.length);
    bars.forEach((color, i) => {
      ctx.fillStyle = color;
      const wob = Math.round(Math.sin((frameBase + i * 2) * 0.9) * 2);
      ctx.fillRect(screen.x + i * bw, screen.y + 3 + wob, bw, screen.h - 6 - wob);
    });
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(screen.x, screen.y, screen.w, 2);
  }

  private drawTicker(ctx: Ctx, s: FrameState, vis: Rect): void {
    const strip = s.ticker;
    if (!strip) return;
    const b = s.sim.building;
    const y = 11 * TILE + 8;
    if (y > vis.y + vis.h || y + 8 < vis.y) return;
    const x0 = TILE;
    const x1 = b.endNorth * TILE;
    const doors = b.areas.filter((a) => a.row === 'north').flatMap((a) => a.doors.map((d) => d.rect));
    const segments: [number, number][] = [];
    let cursor = x0;
    for (const d of [...doors].sort((p, q) => p.x - q.x)) {
      const dx = d.x * TILE - 3;
      if (dx > cursor) segments.push([cursor, dx]);
      cursor = (d.x + d.w) * TILE + 3;
    }
    if (x1 > cursor) segments.push([cursor, x1 - 2]);
    const phase = (s.time * 18) % strip.period;
    for (const [a, z] of segments) {
      const left = Math.max(a, Math.floor(vis.x));
      const right = Math.min(z, Math.ceil(vis.x + vis.w));
      if (right <= left) continue;
      ctx.fillStyle = '#07090d';
      ctx.fillRect(left, y - 1, right - left, 8);
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, y - 1, right - left, 8);
      ctx.clip();
      const first = Math.floor((left + phase) / strip.period) * strip.period - phase;
      for (let px = first; px < right; px += strip.period) ctx.drawImage(strip.canvas, Math.round(px), y - 1);
      ctx.restore();
    }
  }
}
