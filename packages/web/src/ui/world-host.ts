// Stable facade over the current world renderer: survives 2D/3D switches and a missing renderer.
import type { AgentLook, OfficeSnapshot } from '@ai-office/shared';
import {
  DEFAULT_WORLD_OPTIONS,
  type CameraMode,
  type DeskRef,
  type HoverInfo,
  type PreviewPerson,
  type Selection,
  type ViewInsets,
  type WorldApi,
  type WorldOptions,
} from '../world/api';
import { arrangeSnapshot } from '../layout/arrange';
import type { CaptureOptions } from '../world/capture';
import { createWorld, hasRenderer, type WorldKind } from '../world/load';

type Listener<T> = (value: T) => void;

/** Size of the hidden container a capture world is created in (it only needs a non-empty box). */
const CAPTURE_STAGE = { width: 800, height: 450 };
/** Frames a fresh world draws before its picture is taken (day/night and the first layers settle on the first ones). */
const CAPTURE_WARMUP_FRAMES = 3;

export interface WorldCaptureOptions extends CaptureOptions {
  /** Which renderer draws the picture; the live one when absent. The other one is created off-screen for the capture. */
  kind?: WorldKind;
}

let webgl2: boolean | null = null;

/** Whether this browser can create a WebGL2 context (cached). */
function hasWebGL2(): boolean {
  if (webgl2 === null) {
    try {
      webgl2 = document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number): void => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(count);
  });
}

export class WorldHost {
  private world: WorldApi | null = null;
  private currentKind: WorldKind = '2d';
  private options: WorldOptions = DEFAULT_WORLD_OPTIONS;
  private insets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private snapshot: OfficeSnapshot | null = null;
  /** What the server said, before hidden rooms were taken out: people in a hidden room still get a portrait. */
  private fullSnapshot: OfficeSnapshot | null = null;
  private snapshotTime = 0;
  private clock: number | null = null;
  private selection: Selection = null;
  private loadToken = 0;
  private unsubscribers: (() => void)[] = [];
  private readonly selectListeners = new Set<Listener<Selection>>();
  private readonly hoverListeners = new Set<Listener<HoverInfo | null>>();
  private readonly cameraListeners = new Set<Listener<CameraMode>>();
  private readonly boardListeners = new Set<() => void>();
  private readonly deskListeners = new Set<Listener<DeskRef>>();

  constructor(private readonly container: HTMLElement) {}

  get kind(): WorldKind {
    return this.currentKind;
  }

  /** The renderers a picture can be made with: the live one, and the other one when this browser and build have it. */
  captureKinds(): readonly WorldKind[] {
    const live = this.currentKind;
    const other: WorldKind = live === '2d' ? '3d' : '2d';
    const available = other === '2d' ? hasRenderer('2d') : hasRenderer('3d') && hasWebGL2();
    return this.world === null ? [] : available ? [live, other].sort() : [live];
  }

  get ready(): boolean {
    return this.world !== null;
  }

  /** Loads (or reloads) a renderer. Returns a notice when the requested visual had to be replaced. */
  async load(kind: WorldKind): Promise<string | undefined> {
    const token = ++this.loadToken;
    this.detach();
    const result = await createWorld(kind, this.container, { options: this.options, insets: this.insets });
    if (token !== this.loadToken) {
      result.world?.dispose();
      return undefined;
    }
    this.world = result.world;
    this.currentKind = result.kind;
    if (result.world) this.attach(result.world);
    return result.notice;
  }

  private attach(world: WorldApi): void {
    this.unsubscribers = [
      world.onSelect((selection) => {
        this.selection = selection;
        for (const listener of this.selectListeners) listener(selection);
      }),
      world.onHover((hover) => {
        for (const listener of this.hoverListeners) listener(hover);
      }),
      world.onBoardClick(() => {
        for (const listener of this.boardListeners) listener();
      }),
      world.onCameraMode((mode) => {
        for (const listener of this.cameraListeners) listener(mode);
      }),
      world.onDeskClick((desk) => {
        for (const listener of this.deskListeners) listener(desk);
      }),
    ];
    world.setOptions(this.options);
    world.setInsets(this.insets);
    world.setClock(this.clock);
    if (this.snapshot) world.setSnapshot(this.snapshot, this.snapshotTime);
    if (this.selection) world.select(this.selection);
  }

  private detach(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.world?.dispose();
    this.world = null;
    this.container.replaceChildren();
  }

  /** The worlds draw the building the person arranged: hidden rooms and their people are left out, `order` is the slot. */
  setSnapshot(snapshot: OfficeSnapshot, serverNow: number): void {
    const arranged = arrangeSnapshot(snapshot);
    this.fullSnapshot = snapshot;
    this.snapshot = arranged;
    this.snapshotTime = serverNow;
    this.world?.setSnapshot(arranged, serverNow);
  }

  /** See `WorldApi.resetScene`. */
  resetScene(): void {
    this.world?.resetScene();
  }

  /** See `WorldApi.setClock`. */
  setClock(at: number | null): void {
    this.clock = at;
    this.world?.setClock(at);
  }

  setOptions(patch: Partial<WorldOptions>): void {
    this.options = { ...this.options, ...patch };
    this.world?.setOptions(patch);
  }

  getOptions(): WorldOptions {
    return this.world?.getOptions() ?? this.options;
  }

  setInsets(insets: ViewInsets): void {
    this.insets = insets;
    this.world?.setInsets(insets);
  }

  select(selection: Selection, opts?: { focus?: boolean }): void {
    this.selection = selection;
    this.world?.select(selection, opts);
  }

  overview(): void {
    this.world?.overview();
  }

  zoomBy(factor: number): void {
    this.world?.zoomBy(factor);
  }

  focusSelection(): void {
    this.world?.focusSelection();
  }

  cameraModes(): readonly CameraMode[] {
    return this.world?.cameraModes() ?? ['overview'];
  }

  cameraMode(): CameraMode {
    return this.world?.cameraMode() ?? 'overview';
  }

  setCameraMode(mode: CameraMode): void {
    this.world?.setCameraMode(mode);
  }

  portrait(agentId: string, size: number): string | null {
    const drawn = this.world?.portrait(agentId, size);
    if (drawn !== undefined && drawn !== null) return drawn;
    // Somebody in a room hidden from the building is not in the world: draw them from their data.
    const agent = this.fullSnapshot?.agents.find((candidate) => candidate.id === agentId);
    return agent === undefined
      ? null
      : this.previewPortrait({ seed: agent.seed, look: agent.look, kind: agent.kind }, agent.appearance, size);
  }

  previewPortrait(person: PreviewPerson, appearance: AgentLook | undefined, size: number): string | null {
    return this.world?.previewPortrait(person, appearance, size) ?? null;
  }

  stats(): ReturnType<WorldApi['stats']> | null {
    return this.world?.stats() ?? null;
  }

  /**
   * A still image of the office (see `WorldApi.capture`). With `kind` other than the live renderer a second world is
   * created off-screen for the picture and disposed right after; the live one is not touched.
   */
  async capture(opts: WorldCaptureOptions): Promise<HTMLCanvasElement> {
    const live = this.world;
    if (live === null) throw new Error('The office is not ready yet');
    if (opts.kind === undefined || opts.kind === this.currentKind) return live.capture(opts);
    const stage = document.createElement('div');
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${CAPTURE_STAGE.width}px;height:${CAPTURE_STAGE.height}px;pointer-events:none;visibility:hidden`;
    document.body.appendChild(stage);
    let temporary: WorldApi | null = null;
    try {
      const result = await createWorld(opts.kind, stage, {
        options: this.options,
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      });
      temporary = result.world;
      if (temporary === null || result.kind !== opts.kind)
        throw new Error(result.notice ?? 'The renderer is not available');
      temporary.setClock(this.clock);
      if (this.snapshot) temporary.setSnapshot(this.snapshot, this.snapshotTime);
      await nextFrames(CAPTURE_WARMUP_FRAMES);
      return await temporary.capture(opts);
    } finally {
      temporary?.dispose();
      stage.remove();
    }
  }

  resize(): void {
    this.world?.resize();
  }

  onSelect(listener: Listener<Selection>): () => void {
    this.selectListeners.add(listener);
    return () => this.selectListeners.delete(listener);
  }

  onHover(listener: Listener<HoverInfo | null>): () => void {
    this.hoverListeners.add(listener);
    return () => this.hoverListeners.delete(listener);
  }

  onBoardClick(listener: () => void): () => void {
    this.boardListeners.add(listener);
    return () => this.boardListeners.delete(listener);
  }

  onDeskClick(listener: Listener<DeskRef>): () => void {
    this.deskListeners.add(listener);
    return () => this.deskListeners.delete(listener);
  }

  onCameraMode(listener: Listener<CameraMode>): () => void {
    this.cameraListeners.add(listener);
    return () => this.cameraListeners.delete(listener);
  }

  dispose(): void {
    this.loadToken++;
    this.detach();
  }
}
