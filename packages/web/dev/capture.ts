// Dev harness helper for `WorldApi.capture`. Adds `window.__capture({ width, height, mode, showProjectNames })`, which
// resolves to a PNG data URL, and, with `?capture=1` (plus `cw`, `ch`, `cmode=overview|current`, `names=1`), shows the
// picture over the page once the world is ready.
import type { CaptureMode, WorldApi } from '../src/world/api';

declare global {
  interface Window {
    __capture?: (opts?: {
      width?: number;
      height?: number;
      mode?: CaptureMode;
      showProjectNames?: boolean;
    }) => Promise<string>;
  }
}

const DEFAULT_SIZE = { width: 1200, height: 630 };
const SETTLE_MS = 1500;

export function installCapture(world: WorldApi, params: URLSearchParams): void {
  window.__capture = async (opts = {}) => {
    const canvas = await world.capture({
      width: opts.width ?? DEFAULT_SIZE.width,
      height: opts.height ?? DEFAULT_SIZE.height,
      mode: opts.mode ?? 'overview',
      showProjectNames: opts.showProjectNames === true,
    });
    return canvas.toDataURL('image/png');
  };
  if (params.get('capture') !== '1') return;
  setTimeout(() => {
    void window
      .__capture?.({
        width: Number(params.get('cw') ?? DEFAULT_SIZE.width),
        height: Number(params.get('ch') ?? DEFAULT_SIZE.height),
        mode: params.get('cmode') === 'current' ? 'current' : 'overview',
        showProjectNames: params.get('names') === '1',
      })
      .then((url) => {
        const image = new Image();
        image.src = url;
        image.id = 'capture';
        image.style.cssText =
          'position:fixed;inset:0;margin:auto;max-width:100%;max-height:100%;background:#000;z-index:10';
        document.body.appendChild(image);
        document.title = 'captured';
      });
  }, SETTLE_MS);
}
