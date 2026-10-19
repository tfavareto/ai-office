import type { WorldFactory } from '../world/api';
import { World3D } from './world3d';

/** Optional 3D office renderer (three.js). Loaded lazily; throws when WebGL is unavailable so the UI falls back to 2D. */
export const createWorld3D: WorldFactory = (container, opts) => World3D.create(container, opts);
