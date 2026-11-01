// The canvas camera in motion: wheel and button zooms ease toward a target camera (anchored on the cursor), drags move
// it directly, and "fit"/"focus" glide. One rAF loop runs only while the camera is moving.
import { ORIGIN_CAMERA, lerpCamera, panBy, sameCamera, zoomAt, type Camera, type Point } from '../model/geometry';

/** Fraction of the distance to the target left after one second: the smaller, the snappier. */
const REMAINING_PER_SECOND = 0.0008;
const MAX_FRAME_S = 0.05;

export class CameraController {
  private current: Camera = ORIGIN_CAMERA;
  private target: Camera = ORIGIN_CAMERA;
  private raf = 0;
  private last = 0;

  constructor(
    private readonly onChange: (camera: Camera) => void,
    private readonly onSettled: () => void,
    private readonly animated: () => boolean,
  ) {}

  get camera(): Camera {
    return this.current;
  }

  /** Where the camera is heading (the current one when still). */
  get destination(): Camera {
    return this.target;
  }

  /** Sets the camera now. */
  jump(camera: Camera): void {
    this.stopLoop();
    this.current = camera;
    this.target = camera;
    this.onChange(camera);
    this.onSettled();
  }

  /** Glides to a camera (jumps when motion is reduced). */
  glideTo(camera: Camera): void {
    if (!this.animated()) {
      this.jump(camera);
      return;
    }
    this.target = camera;
    this.startLoop();
  }

  /** A drag of the canvas: moves right away, with no easing. */
  dragBy(dx: number, dy: number): void {
    this.current = panBy(this.current, dx, dy);
    this.target = panBy(this.target, dx, dy);
    this.onChange(this.current);
  }

  /** A scroll of the canvas (trackpad): moves right away, and the target with it. */
  scrollBy(dx: number, dy: number): void {
    this.dragBy(dx, dy);
  }

  /** Zooms toward the cursor; repeated calls accumulate on the target. */
  zoomBy(factor: number, anchor: Point): void {
    this.target = zoomAt(this.target, factor, anchor);
    if (!this.animated()) {
      this.current = this.target;
      this.onChange(this.current);
      this.onSettled();
      return;
    }
    this.startLoop();
  }

  /** Pinch: applies at once. */
  zoomNow(factor: number, anchor: Point): void {
    this.current = zoomAt(this.current, factor, anchor);
    this.target = this.current;
    this.onChange(this.current);
  }

  stop(): void {
    this.stopLoop();
    this.target = this.current;
  }

  private startLoop(): void {
    if (this.raf !== 0) return;
    this.last = 0;
    this.raf = requestAnimationFrame((time) => this.frame(time));
  }

  private stopLoop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(time: number): void {
    this.raf = 0;
    const dt = this.last === 0 ? 1 / 60 : Math.min(MAX_FRAME_S, (time - this.last) / 1000);
    this.last = time;
    const amount = 1 - Math.pow(REMAINING_PER_SECOND, dt);
    if (sameCamera(this.current, this.target)) {
      this.current = this.target;
      this.onChange(this.current);
      this.onSettled();
      return;
    }
    this.current = lerpCamera(this.current, this.target, amount);
    this.onChange(this.current);
    this.raf = requestAnimationFrame((next) => this.frame(next));
  }
}
