import type { WorldFactory } from '../world/api';
/** Optional 3D office renderer (three.js). Loaded lazily; throws when WebGL is unavailable so the UI falls back to 2D. */
export declare const createWorld3D: WorldFactory;
