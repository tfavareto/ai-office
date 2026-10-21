// Contract between the UI and a world renderer (2D or 3D). The UI owns the store and panels; the world draws the
// office from snapshots and reports selection/hover. Implementations: world2d (default) and world3d (lazy-loaded).
import type { Locale, OfficeSnapshot } from '@ai-office/shared';

export type Selection = { type: 'agent'; id: string } | { type: 'room'; id: string } | null;

export type DaylightMode = 'auto' | 'day' | 'night';

export interface WorldOptions {
  /** Language of texts drawn in the world (room names, signs, tickers, bubbles). */
  locale: Locale;
  showNames: boolean;
  bubbles: 'all' | 'important' | 'none';
  liveliness: 'calm' | 'normal' | 'lively';
  daylight: DaylightMode;
  /** Camera keeps following the selected agent. */
  followSelected: boolean;
  /** prefers-reduced-motion: no pulsing, no idle wandering. */
  reducedMotion: boolean;
  /** Empty desks answer to the pointer (hover feedback, click to hire). Off when the page cannot hire. */
  hireEnabled: boolean;
  /** Draw the repository state of each room (the plaque under the sign and the branch on the pill). */
  showGit: boolean;
}

/** Free area (CSS px) not covered by panels: camera focus and overview fit inside it. */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** An empty desk in a project room: the place a new agent can be hired at. */
export interface DeskRef {
  projectId: string;
  /** Index of the desk inside the room (0-5). */
  deskIndex: number;
}

export interface HoverInfo {
  agentId: string | null;
  roomId: string | null;
  /** The pointer is over an empty desk (then `roomId` is that desk's room). */
  desk?: DeskRef;
  /** Screen position (CSS px, relative to the container) for the hover tip. */
  x: number;
  y: number;
}

/** Third-person/first-person camera modes; the 2D world supports only 'overview'. */
export type CameraMode = 'overview' | 'first-person' | 'shoulder';

export interface WorldApi {
  readonly kind: '2d' | '3d';
  /** New state from the server (or the mock). Called at most once per frame by the UI. */
  setSnapshot(snapshot: OfficeSnapshot, serverNow: number): void;
  /**
   * Forgets the people and rooms drawn so far: the next snapshot is shown at once, everybody already at their desk and
   * every room built, instead of walking in (a time-lapse that jumps in the day, or goes back to live).
   */
  resetScene(): void;
  /** The instant "automatic" daylight follows (a replay's time of day); `null` goes back to the real clock. */
  setClock(at: number | null): void;
  setOptions(options: Partial<WorldOptions>): void;
  getOptions(): WorldOptions;
  setInsets(insets: ViewInsets): void;
  /** Select from the UI (sidebar, toasts...). `focus` moves the camera to it. */
  select(selection: Selection, opts?: { focus?: boolean }): void;
  onSelect(cb: (selection: Selection) => void): () => void;
  onHover(cb: (hover: HoverInfo | null) => void): () => void;
  /** The meeting-room whiteboard (task board) was clicked. */
  onBoardClick(cb: () => void): () => void;
  /** The person clicked an empty desk (only while `hireEnabled`). */
  onDeskClick(cb: (desk: DeskRef) => void): () => void;
  /** Camera commands from buttons/shortcuts. */
  overview(): void;
  zoomBy(factor: number): void;
  focusSelection(): void;
  cameraModes(): readonly CameraMode[];
  cameraMode(): CameraMode;
  setCameraMode(mode: CameraMode): void;
  onCameraMode(cb: (mode: CameraMode) => void): () => void;
  /** Portrait of an agent for UI avatars (cached data URL), or null while not ready. */
  portrait(agentId: string, size: number): string | null;
  /** Debug/perf info for `window.aiOffice.debug`. */
  stats(): { fps: number; drawMs: number; agents: number; extra?: Record<string, unknown> };
  resize(): void;
  dispose(): void;
}

export interface WorldFactoryOptions {
  options: WorldOptions;
  insets: ViewInsets;
}

export type WorldFactory = (container: HTMLElement, opts: WorldFactoryOptions) => WorldApi | Promise<WorldApi>;

export const DEFAULT_WORLD_OPTIONS: WorldOptions = {
  locale: 'pt-BR',
  showNames: true,
  bubbles: 'important',
  liveliness: 'normal',
  daylight: 'auto',
  followSelected: false,
  reducedMotion: false,
  hireEnabled: false,
  showGit: true,
};
