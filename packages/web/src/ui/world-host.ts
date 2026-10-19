// Stable facade over the current world renderer: survives 2D/3D switches and a missing renderer.
import type { OfficeSnapshot } from '@ai-office/shared';
import {
  DEFAULT_WORLD_OPTIONS,
  type CameraMode,
  type HoverInfo,
  type Selection,
  type ViewInsets,
  type WorldApi,
  type WorldOptions,
} from '../world/api';
import { createWorld, type WorldKind } from '../world/load';

type Listener<T> = (value: T) => void;

export class WorldHost {
  private world: WorldApi | null = null;
  private currentKind: WorldKind = '2d';
  private options: WorldOptions = DEFAULT_WORLD_OPTIONS;
  private insets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private snapshot: OfficeSnapshot | null = null;
  private snapshotTime = 0;
  private selection: Selection = null;
  private loadToken = 0;
  private unsubscribers: (() => void)[] = [];
  private readonly selectListeners = new Set<Listener<Selection>>();
  private readonly hoverListeners = new Set<Listener<HoverInfo | null>>();
  private readonly cameraListeners = new Set<Listener<CameraMode>>();

  constructor(private readonly container: HTMLElement) {}

  get kind(): WorldKind {
    return this.currentKind;
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
      world.onCameraMode((mode) => {
        for (const listener of this.cameraListeners) listener(mode);
      }),
    ];
    world.setOptions(this.options);
    world.setInsets(this.insets);
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

  setSnapshot(snapshot: OfficeSnapshot, serverNow: number): void {
    this.snapshot = snapshot;
    this.snapshotTime = serverNow;
    this.world?.setSnapshot(snapshot, serverNow);
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
    return this.world?.portrait(agentId, size) ?? null;
  }

  stats(): ReturnType<WorldApi['stats']> | null {
    return this.world?.stats() ?? null;
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

  onCameraMode(listener: Listener<CameraMode>): () => void {
    this.cameraListeners.add(listener);
    return () => this.cameraListeners.delete(listener);
  }

  dispose(): void {
    this.loadToken++;
    this.detach();
  }
}
