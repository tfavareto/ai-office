import type { Dir } from '../../layout/types';
import type { Pose } from '../../sim/types';
import type { Look } from './looks';
/** Lazily rendered, cached sprite frame for a look/pose/direction. */
export declare function characterFrame(look: Look, pose: Pose, dir: Dir, frame: number): HTMLCanvasElement;
export declare function clearCharacterCache(): void;
