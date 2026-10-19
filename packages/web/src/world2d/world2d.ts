import type { Agent, OfficeSnapshot } from '@ai-office/shared';
import { worldText } from '../i18n/world/translate';
import { TILE } from '../layout/constants';
import { clamp } from '../layout/rng';
import { OfficeSim } from '../sim/sim';
import {
  DEFAULT_WORLD_OPTIONS,
  type CameraMode,
  type HoverInfo,
  type Selection,
  type ViewInsets,
  type WorldApi,
  type WorldFactoryOptions,
  type WorldOptions,
} from '../world/api';
import { Camera, fitZoom, overviewZoom, type Bounds } from './camera';
import { portraitDataUrl } from './chars/portrait';
import { DayNight } from './lighting';
import { OverlaySprites } from './overlay';
import { OverlayPass } from './overlayPass';
import { pickCharacter, pickRoom } from './picking';
import { Renderer, type FrameState } from './renderer';
import { type RoomInfo, summarizeRoom } from './runtime/boards';
import { type TickerStats, type TickerStrip, renderTicker, tickerFromSnapshot, tickerText } from './runtime/ticker';

const PAN_SPEED = 360;
const DRAG_THRESHOLD = 4;
const WHEEL_STEP = 50;
const MAX_DPR = 3;
const ROOM_FOCUS_PAD = 24;
const ROOM_FOCUS_MAX_ZOOM = 4;

/** Canvas2D renderer of the office: pixel-art layers, simulation-driven characters, day/night and overlay. */
export class World2D implements WorldApi {
  readonly kind = '2d' as const;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sim = new OfficeSim(20260101);
  private readonly renderer = new Renderer();
  private readonly cam = new Camera();
  private readonly dayNight = new DayNight();
  private readonly sprites = new OverlaySprites();
  private readonly overlay = new OverlayPass();
  private readonly resizeObserver: ResizeObserver;

  private options: WorldOptions;
  private insets: ViewInsets;
  private selection: Selection = null;
  private hover: { agentId: string | null; roomId: string | null } = { agentId: null, roomId: null };
  private agents = new Map<string, Agent>();
  private roomInfo = new Map<string, RoomInfo>();
  private accountColors = new Map<string, string>();
  private ticker: TickerStrip | null = null;
  private tickerKey = '';
  private tickerStats: TickerStats | null = null;

  private raf = 0;
  private last = 0;
  private clock = 0;
  private fps = 60;
  private drawMs = 0;
  private disposed = false;
  private fitted = false;
  /** Building width (tiles) the overview was last fitted to: a growing/shrinking building refits an untouched camera. */
  private fittedWidth = 0;
  private userMoved = false;
  private followPause = 0;

  private pointer: { id: number; x: number; y: number; startX: number; startY: number; dragging: boolean } | null = null;
  private wheelAccum = 0;
  private keys = new Set<string>();

  private readonly selectListeners = new Set<(s: Selection) => void>();
  private readonly hoverListeners = new Set<(h: HoverInfo | null) => void>();
  private readonly modeListeners = new Set<(m: CameraMode) => void>();
  private readonly portraitCache = new Map<string, string>();

  constructor(private readonly container: HTMLElement, opts: WorldFactoryOptions) {
    this.options = { ...DEFAULT_WORLD_OPTIONS, ...opts.options };
    this.insets = { ...opts.insets };
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;cursor:grab';
    this.canvas.tabIndex = 0;
    this.updateAriaLabel();
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.canvas);
    this.applyOptions();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('resize', this.onWindowResize);
    this.bind();
    this.resize();
    this.cam.zoom = 2;
    this.raf = requestAnimationFrame((t) => this.frame(t));
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
    this.updateTicker(snapshot);
    if (this.selection?.type === 'agent' && !this.agents.has(this.selection.id)) this.selection = null;
  }

  private updateTicker(snapshot: OfficeSnapshot): void {
    this.tickerStats = tickerFromSnapshot(snapshot);
    this.refreshTicker();
  }

  /** Re-renders the LED strip when its text changed (new numbers, or another language). */
  private refreshTicker(): void {
    const stats = this.tickerStats;
    if (!stats) return;
    const text = tickerText(stats.rooms, stats.agents, stats.working, stats.waiting, stats.shells, worldText(this.options.locale));
    if (text !== this.tickerKey) {
      this.tickerKey = text;
      this.ticker = renderTicker(text);
    }
  }

  private updateAriaLabel(): void {
    this.canvas.setAttribute('aria-label', worldText(this.options.locale).t('world.aria2d'));
  }

  setOptions(options: Partial<WorldOptions>): void {
    const previous = this.options.locale;
    this.options = { ...this.options, ...options };
    this.applyOptions();
    if (this.options.locale !== previous) this.onLocaleChanged();
  }

  /**
   * Texts drawn in the world follow `options.locale`. Cached pieces are keyed by language (static area layers, wall
   * boards, label sprites), so only the ones that hold words are redrawn on the next frame; the camera, the selection
   * and the simulation are untouched. The ticker strip and the accessible name are rebuilt here.
   */
  private onLocaleChanged(): void {
    this.updateAriaLabel();
    this.refreshTicker();
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
    this.cam.view = { ...this.cam.view, insets: this.insets };
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

  overview(animate = true): void {
    const b = this.sim.building;
    const size = { w: b.width * TILE, h: b.height * TILE };
    const zoom = overviewZoom(size, this.cam.view, this.cam.dpr);
    this.cam.frame({ x: size.w / 2, y: size.h / 2 }, zoom, !animate || !this.fitted);
    this.fitted = true;
    this.fittedWidth = b.width;
    this.userMoved = false;
  }

  zoomBy(factor: number): void {
    const fc = { x: (this.insets.left + this.cam.view.width - this.insets.right) / 2, y: (this.insets.top + this.cam.view.height - this.insets.bottom) / 2 };
    if (factor === 1) return;
    this.userMoved = true;
    this.zoomAtScreen(factor > 1 ? 1 : -1, fc.x, fc.y);
  }

  private zoomAtScreen(direction: 1 | -1, sx: number, sy: number): void {
    this.cam.zoomAt(direction, sx, sy);
  }

  focusSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    this.userMoved = true;
    if (sel.type === 'agent') {
      const c = this.sim.character(sel.id);
      if (!c) return;
      const zoom = this.cam.zoom < 3 ? (this.cam.levels.includes(3) ? 3 : 2) : this.cam.zoom;
      this.cam.frame({ x: c.x * TILE, y: c.y * TILE - 8 }, zoom, false);
      return;
    }
    const room = this.sim.rooms.live(sel.id);
    const area = room && this.sim.building.areas.find((a) => a.id === room.areaId);
    if (!area) return;
    const bounds: Bounds = {
      x: area.rect.x * TILE - ROOM_FOCUS_PAD,
      y: area.rect.y * TILE - ROOM_FOCUS_PAD,
      w: area.rect.w * TILE + ROOM_FOCUS_PAD * 2,
      h: area.rect.h * TILE + ROOM_FOCUS_PAD * 2,
    };
    const zoom = Math.min(ROOM_FOCUS_MAX_ZOOM, fitZoom(bounds, this.cam.view, this.cam.levels));
    this.cam.frame({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }, zoom, false);
  }

  cameraModes(): readonly CameraMode[] {
    return ['overview'];
  }

  cameraMode(): CameraMode {
    return 'overview';
  }

  setCameraMode(): void {
    for (const cb of this.modeListeners) cb('overview');
  }

  onCameraMode(cb: (mode: CameraMode) => void): () => void {
    this.modeListeners.add(cb);
    return () => this.modeListeners.delete(cb);
  }

  portrait(agentId: string, size: number): string | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const key = `${agentId}|${agent.seed}|${size}`;
    let url = this.portraitCache.get(key);
    if (!url) {
      url = portraitDataUrl(this.renderer.lookOf(agent), size);
      this.portraitCache.set(key, url);
    }
    return url;
  }

  stats(): { fps: number; drawMs: number; agents: number; extra?: Record<string, unknown> } {
    const live = this.sim.characters.length;
    return {
      fps: Math.round(this.fps * 10) / 10,
      drawMs: Math.round(this.drawMs * 100) / 100,
      agents: live,
      extra: {
        zoom: this.cam.zoom,
        camera: { cx: Math.round(this.cam.cx), cy: Math.round(this.cam.cy), tx: Math.round(this.cam.tx), ty: Math.round(this.cam.ty) },
        rooms: this.sim.roomStates.length,
        bubbles: this.sim.bubbles.length,
        night: Math.round(this.dayNight.night * 100) / 100,
        layoutVersion: this.sim.layoutVersion,
      },
    };
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.cam.dpr = dpr;
    this.cam.view = { width, height, insets: this.insets };
    if (this.fitted && !this.userMoved) this.overview(false);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.remove();
    this.selectListeners.clear();
    this.hoverListeners.clear();
    this.modeListeners.clear();
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

    this.sim.advance(dt);
    this.dayNight.update(dt);
    this.updateCamera(dt);
    const t0 = performance.now();
    this.ctx.save();
    const state = this.frameState(dt);
    this.renderer.draw(this.ctx, state);
    this.overlay.draw(this.ctx, this.sprites, state);
    this.ctx.restore();
    this.drawMs += (performance.now() - t0 - this.drawMs) * 0.1;
  }

  private frameState(dt: number): FrameState {
    return {
      sim: this.sim,
      cam: this.cam,
      night: this.dayNight.night,
      time: this.clock,
      dt,
      selection: this.selection,
      hover: this.hover,
      options: this.options,
      roomInfo: this.roomInfo,
      agents: this.agents,
      accountColor: (id) => this.accountColors.get(id) ?? '#8d99ad',
      ticker: this.ticker,
    };
  }

  private updateCamera(dt: number): void {
    const b = this.sim.building;
    const ex = this.renderer.layers.exterior;
    if (ex) this.cam.limits = { x: ex.x + 160, y: ex.y + 160, w: ex.canvas.width - 320, h: ex.canvas.height - 320 };
    if (!this.fitted && this.sim.characters.length + b.areas.length > 0 && this.cam.view.width > 10) {
      this.overview(false);
    } else if (this.fitted && !this.userMoved && b.width !== this.fittedWidth) {
      this.overview(true);
    }
    const pan = this.keyPan();
    if (pan.x || pan.y) {
      const speed = (PAN_SPEED * (this.keys.has('shift') ? 2.2 : 1) * dt) / this.cam.zoom;
      this.cam.cx += pan.x * speed;
      this.cam.cy += pan.y * speed;
      this.cam.tx = this.cam.cx;
      this.cam.ty = this.cam.cy;
      this.cam.clamp();
      this.userMoved = true;
      this.followPause = 2;
    }
    this.followPause = Math.max(0, this.followPause - dt);
    if (this.options.followSelected && this.selection?.type === 'agent' && this.followPause === 0) {
      const c = this.sim.character(this.selection.id);
      if (c) this.cam.focus(c.x * TILE, c.y * TILE - 8);
    }
    this.cam.update(dt, this.options.reducedMotion ? 30 : 8);
  }

  private keyPan(): { x: number; y: number } {
    const k = this.keys;
    return {
      x: (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0),
      y: (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // input

  private bind(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('dblclick', this.onDoubleClick);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    const p = this.local(e);
    this.pointer = { id: e.pointerId, x: p.x, y: p.y, startX: p.x, startY: p.y, dragging: false };
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.focus({ preventScroll: true });
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const ptr = this.pointer;
    if (ptr && ptr.id === e.pointerId) {
      if (!ptr.dragging && Math.hypot(p.x - ptr.startX, p.y - ptr.startY) > DRAG_THRESHOLD) {
        ptr.dragging = true;
        this.canvas.style.cursor = 'grabbing';
        this.setHover(null, null, p);
      }
      if (ptr.dragging) {
        this.cam.pan(p.x - ptr.x, p.y - ptr.y);
        this.userMoved = true;
        this.followPause = 2;
      }
      ptr.x = p.x;
      ptr.y = p.y;
      return;
    }
    this.updateHover(p);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const ptr = this.pointer;
    if (!ptr || ptr.id !== e.pointerId) return;
    this.pointer = null;
    this.canvas.style.cursor = 'grab';
    if (!ptr.dragging && e.type === 'pointerup') this.click(this.local(e));
  };

  private onPointerLeave = (): void => {
    if (!this.pointer) this.setHover(null, null, null);
  };

  private pickAt(p: { x: number; y: number }): Selection {
    const w = this.cam.screenToWorld(p.x, p.y);
    const person = pickCharacter(this.sim.characters, w.x, w.y);
    if (person) return { type: 'agent', id: person.agentId };
    const room = pickRoom(this.sim.building, this.sim.roomStates, w.x, w.y);
    return room ? { type: 'room', id: room } : null;
  }

  private click(p: { x: number; y: number }): void {
    const picked = this.pickAt(p);
    this.selection = picked;
    for (const cb of this.selectListeners) cb(picked);
  }

  private onDoubleClick = (e: MouseEvent): void => {
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
    this.canvas.style.cursor = picked ? 'pointer' : 'grab';
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
    this.wheelAccum += e.deltaY * unit * (e.ctrlKey ? 4 : 1);
    if (Math.abs(this.wheelAccum) < WHEEL_STEP) return;
    const direction = this.wheelAccum < 0 ? 1 : -1;
    this.wheelAccum = 0;
    const p = this.local(e);
    this.userMoved = true;
    this.zoomAtScreen(direction, p.x, p.y);
  };

  private typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || this.typing(e)) return;
    const key = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      this.keys.add(key);
      if (key.startsWith('arrow')) e.preventDefault();
    } else if (key === 'shift') this.keys.add('shift');
    else if ((key === '+' || key === '=') && !e.repeat) this.zoomBy(1.25);
    else if (key === '-' && !e.repeat) this.zoomBy(1 / 1.25);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private onWindowResize = (): void => this.resize();

  private onBlur = (): void => {
    this.keys.clear();
  };
}
