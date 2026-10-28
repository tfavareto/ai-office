// A small map of the whole canvas with the part on screen outlined; a click or a drag on it moves the camera.
import { h } from '../../ui/dom';
import { expandRect, unionRects, type Point, type Rect } from '../model/geometry';

const WIDTH = 188;
const HEIGHT = 116;
const MARGIN = 120;

export interface MinimapModel {
  frames: readonly { rect: Rect; color: string }[];
  nodes: readonly { rect: Rect; active: boolean }[];
  /** What the screen shows, in world units. */
  view: Rect;
}

export class Minimap {
  readonly el = h('canvas', { class: 'ao-pro-minimap', width: WIDTH, height: HEIGHT, 'aria-hidden': 'true' });
  private readonly ctx = this.el.getContext('2d');
  private world: Rect | null = null;
  private scale = 1;
  private offset: Point = { x: 0, y: 0 };
  private dragging = false;

  constructor(private readonly onCenter: (world: Point) => void) {
    const ratio = window.devicePixelRatio || 1;
    this.el.width = Math.round(WIDTH * ratio);
    this.el.height = Math.round(HEIGHT * ratio);
    this.el.style.width = `${WIDTH}px`;
    this.el.style.height = `${HEIGHT}px`;
    this.ctx?.scale(ratio, ratio);
    this.el.addEventListener('pointerdown', (event) => {
      this.dragging = true;
      this.el.setPointerCapture(event.pointerId);
      this.center(event);
    });
    this.el.addEventListener('pointermove', (event) => {
      if (this.dragging) this.center(event);
    });
    const end = (): void => {
      this.dragging = false;
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  private center(event: PointerEvent): void {
    if (this.world === null) return;
    const box = this.el.getBoundingClientRect();
    this.onCenter({
      x: (event.clientX - box.left - this.offset.x) / this.scale + this.world.x,
      y: (event.clientY - box.top - this.offset.y) / this.scale + this.world.y,
    });
  }

  draw(model: MinimapModel, dark: boolean): void {
    const ctx = this.ctx;
    if (ctx === null) return;
    const all = unionRects([...model.frames.map((frame) => frame.rect), model.view]);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (all === null) return;
    const world = expandRect(all, MARGIN);
    this.world = world;
    this.scale = Math.min(WIDTH / world.width, HEIGHT / world.height);
    this.offset = { x: (WIDTH - world.width * this.scale) / 2, y: (HEIGHT - world.height * this.scale) / 2 };
    const at = (rect: Rect): Rect => ({
      x: (rect.x - world.x) * this.scale + this.offset.x,
      y: (rect.y - world.y) * this.scale + this.offset.y,
      width: rect.width * this.scale,
      height: rect.height * this.scale,
    });
    for (const frame of model.frames) {
      const box = at(frame.rect);
      ctx.fillStyle = frame.color;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = frame.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
    }
    ctx.globalAlpha = 1;
    for (const node of model.nodes) {
      const box = at(node.rect);
      ctx.fillStyle = node.active ? '#3ecf8e' : dark ? 'rgba(200,210,225,0.55)' : 'rgba(60,70,90,0.5)';
      ctx.fillRect(box.x, box.y, Math.max(2, box.width), Math.max(2, box.height));
    }
    const view = at(model.view);
    ctx.strokeStyle = dark ? '#6ea2ff' : '#2f6fed';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(view.x, view.y, view.width, view.height);
  }
}
