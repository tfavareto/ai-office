import type { Dir } from '../../layout/types';
import type { Pose } from '../../sim/types';
import { drawPerson } from './sprites';
import type { Look } from './looks';

const frames = new Map<string, HTMLCanvasElement>();

/** Lazily rendered, cached sprite frame for a look/pose/direction. */
export function characterFrame(look: Look, pose: Pose, dir: Dir, frame: number): HTMLCanvasElement {
  const key = `${look.key}|${pose}|${dir}|${frame}`;
  let canvas = frames.get(key);
  if (!canvas) {
    canvas = drawPerson(look, pose, dir, frame);
    frames.set(key, canvas);
  }
  return canvas;
}

export function clearCharacterCache(): void {
  frames.clear();
}
