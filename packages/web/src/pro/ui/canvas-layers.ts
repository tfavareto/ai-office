// The drawn layers under the terminals: each room's name line (a button that opens the room panel) and the thin
// connectors from orchestrators down to their subagents. No boxes, no colors besides the status of a connector.
import { t } from '../../i18n';
import { h, setAttr, setText, svg } from '../../ui/dom';
import type { FrameModel, LinkModel } from '../model/canvas-models';
import { linkPath } from '../model/links';

interface FrameView {
  el: HTMLElement;
  head: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
}

interface LinkView {
  path: SVGPathElement;
  d: string;
  state: string;
}

export class CanvasLayers {
  readonly frames = h('div', { class: 'ao-pro-frames' });
  readonly svg = svg('svg', { class: 'ao-pro-links', width: 1, height: 1, 'aria-hidden': 'true', focusable: 'false' });
  private readonly frameViews = new Map<string, FrameView>();
  private readonly linkViews = new Map<string, LinkView>();
  private openRoom: string | null = null;

  /** `onOpen` opens the room panel from the keyboard (the pointer is handled by the canvas, which also pans). */
  constructor(private readonly onOpen: (roomId: string) => void) {}

  /** The room whose panel is open (its header shows it). */
  setOpenRoom(roomId: string | null): void {
    this.openRoom = roomId;
    for (const [id, view] of this.frameViews) setAttr(view.head, 'aria-expanded', String(id === roomId));
  }

  syncFrames(models: readonly FrameModel[]): void {
    const seen = new Set<string>();
    for (const model of models) {
      seen.add(model.roomId);
      let view = this.frameViews.get(model.roomId);
      if (view === undefined) {
        view = this.createFrame(model.roomId);
        this.frameViews.set(model.roomId, view);
        this.frames.appendChild(view.el);
      }
      setText(view.name, model.name);
      setText(view.meta, model.meta);
      setAttr(view.head, 'aria-label', t('pro.frame.open', { room: model.name }));
      setAttr(view.head, 'aria-expanded', String(model.roomId === this.openRoom));
      view.el.style.width = `${model.rect.width}px`;
      view.el.style.height = `${model.rect.height}px`;
      view.el.style.transform = `translate(${model.rect.x}px, ${model.rect.y}px)`;
    }
    for (const [id, view] of this.frameViews)
      if (!seen.has(id)) {
        view.el.remove();
        this.frameViews.delete(id);
      }
  }

  private createFrame(roomId: string): FrameView {
    const name = h('strong', { class: 'ao-pro-frame-name' });
    const meta = h('span', { class: 'ao-pro-frame-meta' });
    const head = h(
      'header',
      { class: 'ao-pro-frame-head', role: 'button', tabindex: '0', 'data-room-id': roomId },
      name,
      meta,
    );
    head.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.onOpen(roomId);
    });
    const el = h('section', { class: 'ao-pro-frame is-new' }, head);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-new')));
    return { el, head, name, meta };
  }

  /** The header of a room's frame (to give the keyboard back to it when its panel closes). */
  frameHead(roomId: string): HTMLElement | undefined {
    return this.frameViews.get(roomId)?.head;
  }

  syncLinks(models: readonly LinkModel[]): void {
    const seen = new Set<string>();
    for (const model of models) {
      seen.add(model.id);
      let view = this.linkViews.get(model.id);
      if (view === undefined) {
        view = { path: svg('path', { class: 'ao-pro-link', fill: 'none' }), d: '', state: '' };
        this.linkViews.set(model.id, view);
        this.svg.appendChild(view.path);
      }
      const geometry = linkPath(model.from, model.to);
      if (geometry.d !== view.d) {
        view.d = geometry.d;
        view.path.setAttribute('d', geometry.d);
      }
      if (view.state !== model.state) {
        view.state = model.state;
        view.path.setAttribute('class', `ao-pro-link is-${model.state}`);
        // Connectors to one column share their trunk: an active one is drawn over the calm ones.
        if (model.state === 'waiting' || model.state === 'flowing') this.svg.appendChild(view.path);
        else this.svg.prepend(view.path);
      }
    }
    for (const [id, view] of this.linkViews)
      if (!seen.has(id)) {
        view.path.remove();
        this.linkViews.delete(id);
      }
  }
}
