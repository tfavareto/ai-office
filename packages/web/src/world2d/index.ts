import type { OfficeSnapshot } from '@ai-office/shared';
import {
  DEFAULT_WORLD_OPTIONS,
  type CameraMode,
  type HoverInfo,
  type Selection,
  type ViewInsets,
  type WorldApi,
  type WorldFactory,
  type WorldOptions,
} from '../world/api';

/** Minimal 2D world: a canvas that clears itself. Replaced by the full renderer as it grows. */
export const createWorld2D: WorldFactory = (container, opts) => {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  container.appendChild(canvas);
  let options: WorldOptions = { ...DEFAULT_WORLD_OPTIONS, ...opts.options };
  let insets: ViewInsets = opts.insets;
  let snapshot: OfficeSnapshot | null = null;
  const selectListeners = new Set<(s: Selection) => void>();
  const hoverListeners = new Set<(h: HoverInfo | null) => void>();
  const modeListeners = new Set<(m: CameraMode) => void>();

  const api: WorldApi = {
    kind: '2d',
    setSnapshot(s) {
      snapshot = s;
    },
    setOptions(o) {
      options = { ...options, ...o };
    },
    getOptions: () => options,
    setInsets(i) {
      insets = i;
    },
    select(s) {
      selectListeners.forEach((cb) => cb(s));
    },
    onSelect(cb) {
      selectListeners.add(cb);
      return () => selectListeners.delete(cb);
    },
    onHover(cb) {
      hoverListeners.add(cb);
      return () => hoverListeners.delete(cb);
    },
    overview() {},
    zoomBy() {},
    focusSelection() {},
    cameraModes: () => ['overview'],
    cameraMode: () => 'overview',
    setCameraMode() {},
    onCameraMode(cb) {
      modeListeners.add(cb);
      return () => modeListeners.delete(cb);
    },
    portrait: () => null,
    stats: () => ({ fps: 0, drawMs: 0, agents: snapshot?.agents.length ?? 0, extra: { insets } }),
    resize() {},
    dispose() {
      canvas.remove();
    },
  };
  return api;
};
