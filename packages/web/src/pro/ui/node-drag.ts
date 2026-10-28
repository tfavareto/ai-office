// Dragging terminals on the canvas: the title bar of a subagent moves that terminal; the title bar of an orchestrator
// moves its whole cluster (hold Shift to move only the terminal). Positions are offsets, remembered when the drag ends.
import type { Point } from '../model/geometry';

const DRAG_THRESHOLD_PX = 4;

export interface DragTarget {
  kind: 'cluster' | 'panel';
  /** Cluster: the orchestrator's id. Panel: the terminal's id. */
  id: string;
  /** The offset it had when the drag started. */
  base: Point;
}

export interface ActiveDrag extends DragTarget {
  /** The extra offset of this drag, in world units. */
  delta: Point;
}

export interface DragHost {
  /** What dragging this title bar would move, or null. */
  resolve(nodeId: string, shift: boolean): DragTarget | null;
  zoom(): number;
  onMove(drag: ActiveDrag): void;
  onEnd(drag: ActiveDrag, moved: boolean): void;
}

export class NodeDrag {
  private active: (ActiveDrag & { pointerId: number; start: Point; moved: boolean }) | null = null;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly host: DragHost,
  ) {
    viewport.addEventListener('pointermove', (event) => this.move(event));
    viewport.addEventListener('pointerup', (event) => this.end(event));
    viewport.addEventListener('pointercancel', (event) => this.end(event));
  }

  get current(): ActiveDrag | null {
    return this.active;
  }

  /** Starts a drag when the press is on a title bar; returns whether it took the event. */
  pointerDown(event: PointerEvent): boolean {
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
    const head = event.target.closest('[data-drag]');
    if (head === null || event.target.closest('[data-no-drag]') !== null) return false;
    const nodeId = head.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    if (nodeId === undefined) return false;
    const target = this.host.resolve(nodeId, event.shiftKey);
    if (target === null) return false;
    this.viewport.setPointerCapture(event.pointerId);
    this.active = {
      ...target,
      delta: { x: 0, y: 0 },
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    return true;
  }

  private move(event: PointerEvent): void {
    const drag = this.active;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const zoom = this.host.zoom();
    drag.delta = { x: Math.round(dx / zoom), y: Math.round(dy / zoom) };
    this.host.onMove(drag);
  }

  private end(event: PointerEvent): void {
    const drag = this.active;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    this.active = null;
    this.host.onEnd(drag, drag.moved);
  }
}
