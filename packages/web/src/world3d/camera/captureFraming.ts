// Framing math of a 3D capture (pure): the isometric camera state a still image is taken from.
import { boxCorners, fitPoints, type Basis, type Box3Like, type IsoState } from './isoCamera';

export interface Size {
  width: number;
  height: number;
}

/** Margin around the building, as a share of the picture's shorter side. */
export const CAPTURE_MARGIN_RATIO = 0.035;

const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/** The whole `box` (the office) centred in a picture of `out`. */
export function overviewIso(box: Box3Like, basis: Basis, out: Size): IsoState {
  const margin = Math.round(Math.min(out.width, out.height) * CAPTURE_MARGIN_RATIO);
  return fitPoints(boxCorners(box), basis, { width: out.width, height: out.height, insets: NO_INSETS }, margin);
}

/**
 * What the live overview camera shows: the same ground point at the middle and the whole free area of the live view
 * (the view minus its panels), scaled so it fits the picture.
 */
export function currentIso(live: { iso: IsoState; free: Size }, out: Size): IsoState {
  const scale = Math.min(out.width / Math.max(1, live.free.width), out.height / Math.max(1, live.free.height));
  return { target: live.iso.target, zoom: live.iso.zoom * scale };
}
