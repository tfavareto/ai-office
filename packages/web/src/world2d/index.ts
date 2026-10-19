import type { WorldFactory } from '../world/api';
import { World2D } from './world2d';

/** Default 2D pixel-art office renderer (Canvas2D). */
export const createWorld2D: WorldFactory = (container, opts) => new World2D(container, opts);
