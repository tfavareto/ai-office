import type { OfficeSnapshot } from '@ai-office/shared';
import { type CameraMode, type HoverInfo, type Selection, type ViewInsets, type WorldApi, type WorldOptions } from '../world/api';
import { type WorldKind } from '../world/load';
type Listener<T> = (value: T) => void;
export declare class WorldHost {
    private readonly container;
    private world;
    private currentKind;
    private options;
    private insets;
    private snapshot;
    private snapshotTime;
    private selection;
    private loadToken;
    private unsubscribers;
    private readonly selectListeners;
    private readonly hoverListeners;
    private readonly cameraListeners;
    constructor(container: HTMLElement);
    get kind(): WorldKind;
    get ready(): boolean;
    /** Loads (or reloads) a renderer. Returns a notice when the requested visual had to be replaced. */
    load(kind: WorldKind): Promise<string | undefined>;
    private attach;
    private detach;
    setSnapshot(snapshot: OfficeSnapshot, serverNow: number): void;
    setOptions(patch: Partial<WorldOptions>): void;
    getOptions(): WorldOptions;
    setInsets(insets: ViewInsets): void;
    select(selection: Selection, opts?: {
        focus?: boolean;
    }): void;
    overview(): void;
    zoomBy(factor: number): void;
    focusSelection(): void;
    cameraModes(): readonly CameraMode[];
    cameraMode(): CameraMode;
    setCameraMode(mode: CameraMode): void;
    portrait(agentId: string, size: number): string | null;
    stats(): ReturnType<WorldApi['stats']> | null;
    resize(): void;
    onSelect(listener: Listener<Selection>): () => void;
    onHover(listener: Listener<HoverInfo | null>): () => void;
    onCameraMode(listener: Listener<CameraMode>): () => void;
    dispose(): void;
}
export {};
