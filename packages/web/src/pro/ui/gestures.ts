// Moving around the canvas: drag the background (or hold Space and drag anywhere), scroll with a trackpad, zoom with
// the wheel or a pinch (toward the cursor), and pinch with two fingers on a touch screen.
import type { Point } from '../model/geometry';
import type { CameraController } from './camera-controller';

/** Wheel zoom: one 100-unit notch is about 17 %; a trackpad pinch reports small deltas and needs a bigger factor. */
const WHEEL_ZOOM_RATE = 0.0018;
const PINCH_ZOOM_RATE = 0.01;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;
/** Parts of a terminal that scroll by themselves: the wheel scrolls them instead of the canvas. */
const SCROLLABLE = '.ao-pro-body, .ao-pro-done, textarea';

/** A wheel that comes from a mouse (whole notches) rather than from a trackpad (small, fractional deltas). */
export function isMouseWheel(event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>): boolean {
  if (event.deltaMode !== 0) return true;
  const steps = Math.abs(event.deltaY);
  return event.deltaX === 0 && Number.isInteger(event.deltaY) && steps > 0 && (steps % 100 === 0 || steps % 120 === 0);
}

/** The wheel's vertical delta in pixels, whatever the unit the browser reports. */
export function wheelDelta(event: Pick<WheelEvent, 'deltaMode' | 'deltaY'>): number {
  if (event.deltaMode === 1) return event.deltaY * LINE_HEIGHT_PX;
  if (event.deltaMode === 2) return event.deltaY * PAGE_HEIGHT_PX;
  return event.deltaY;
}

export class ViewportGestures {
  private spaceHeld = false;
  private panning: { id: number; last: Point } | null = null;
  private readonly touches = new Map<number, Point>();
  private pinchDistance = 0;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly camera: CameraController,
    private readonly onMotion: () => void,
  ) {
    viewport.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    viewport.addEventListener('pointermove', (event) => this.onPointerMove(event));
    viewport.addEventListener('pointerup', (event) => this.onPointerEnd(event));
    viewport.addEventListener('pointercancel', (event) => this.onPointerEnd(event));
  }

  get isSpaceHeld(): boolean {
    return this.spaceHeld;
  }

  setSpace(held: boolean): void {
    if (held === this.spaceHeld) return;
    this.spaceHeld = held;
    this.viewport.classList.toggle('is-space', held);
  }

  /** Starts a pan (or a pinch) when the press is one; returns whether it took the event. */
  pointerDown(event: PointerEvent, onBackground: boolean): boolean {
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size === 2) {
        this.pinchDistance = this.distance();
        this.panning = null;
        return true;
      }
    }
    const wantsPan = event.button === 1 || (event.button === 0 && (this.spaceHeld || onBackground));
    if (!wantsPan) return false;
    event.preventDefault();
    this.viewport.setPointerCapture(event.pointerId);
    this.panning = { id: event.pointerId, last: { x: event.clientX, y: event.clientY } };
    this.viewport.classList.add('is-panning');
    return true;
  }

  private distance(): number {
    const [a, b] = [...this.touches.values()];
    return a === undefined || b === undefined ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
  }

  private onPointerMove(event: PointerEvent): void {
    if (this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size === 2 && this.pinchDistance > 0) {
        const next = this.distance();
        const [a, b] = [...this.touches.values()] as [Point, Point];
        const box = this.viewport.getBoundingClientRect();
        this.camera.zoomNow(next / this.pinchDistance, {
          x: (a.x + b.x) / 2 - box.left,
          y: (a.y + b.y) / 2 - box.top,
        });
        this.pinchDistance = next;
        this.onMotion();
        return;
      }
    }
    const panning = this.panning;
    if (panning === null || panning.id !== event.pointerId) return;
    this.camera.dragBy(event.clientX - panning.last.x, event.clientY - panning.last.y);
    panning.last = { x: event.clientX, y: event.clientY };
    this.onMotion();
  }

  private onPointerEnd(event: PointerEvent): void {
    this.touches.delete(event.pointerId);
    if (this.touches.size < 2) this.pinchDistance = 0;
    if (this.panning?.id !== event.pointerId) return;
    this.panning = null;
    this.viewport.classList.remove('is-panning');
  }

  private onWheel(event: WheelEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    const zoomGesture = event.ctrlKey || event.metaKey;
    if (!zoomGesture && target?.closest(SCROLLABLE) !== null && target !== null) return;
    event.preventDefault();
    const box = this.viewport.getBoundingClientRect();
    const anchor = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (zoomGesture || isMouseWheel(event)) {
      const rate = zoomGesture ? PINCH_ZOOM_RATE : WHEEL_ZOOM_RATE;
      this.camera.zoomBy(Math.exp(-wheelDelta(event) * rate), anchor);
    } else {
      this.camera.scrollBy(-event.deltaX, -event.deltaY);
    }
    this.onMotion();
  }
}
