// The drawn layers under the terminals: the room frames, the lines from orchestrators to subagents, and their labels.
import { h, setText, svg, toggleClass } from '../../ui/dom';
import type { Rect } from '../model/geometry';
import { linkPath, type LinkLabel, type LinkState } from '../model/links';

export interface FrameModel {
  roomId: string;
  name: string;
  color: string;
  rect: Rect;
  meta: string;
}

export interface LinkModel {
  /** The subagent's id. */
  id: string;
  from: Rect;
  to: Rect;
  state: LinkState;
  label: LinkLabel;
}

interface FrameView {
  el: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
}

interface LinkView {
  group: SVGGElement;
  path: SVGPathElement;
  start: SVGCircleElement;
  end: SVGCircleElement;
  label: HTMLElement;
  role: HTMLElement;
  task: HTMLElement;
  d: string;
}

export class CanvasLayers {
  readonly frames = h('div', { class: 'ao-pro-frames', 'aria-hidden': 'true' });
  readonly svg = svg('svg', { class: 'ao-pro-links', width: 1, height: 1, 'aria-hidden': 'true', focusable: 'false' });
  readonly labels = h('div', { class: 'ao-pro-labels', 'aria-hidden': 'true' });
  private readonly frameViews = new Map<string, FrameView>();
  private readonly linkViews = new Map<string, LinkView>();

  syncFrames(models: readonly FrameModel[]): void {
    const seen = new Set<string>();
    for (const model of models) {
      seen.add(model.roomId);
      let view = this.frameViews.get(model.roomId);
      if (view === undefined) {
        view = this.createFrame();
        this.frameViews.set(model.roomId, view);
        this.frames.appendChild(view.el);
      }
      setText(view.name, model.name);
      setText(view.meta, model.meta);
      view.el.style.setProperty('--room', model.color);
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

  private createFrame(): FrameView {
    const name = h('strong', { class: 'ao-pro-frame-name' });
    const meta = h('span', { class: 'ao-pro-frame-meta' });
    const el = h(
      'section',
      { class: 'ao-pro-frame is-new' },
      h('header', { class: 'ao-pro-frame-head' }, h('span', { class: 'ao-pro-frame-dot' }), name, meta),
    );
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('is-new')));
    return { el, name, meta };
  }

  syncLinks(models: readonly LinkModel[]): void {
    const seen = new Set<string>();
    for (const model of models) {
      seen.add(model.id);
      let view = this.linkViews.get(model.id);
      if (view === undefined) {
        view = this.createLink();
        this.linkViews.set(model.id, view);
        this.svg.appendChild(view.group);
        this.labels.appendChild(view.label);
      }
      const geometry = linkPath(model.from, model.to);
      if (geometry.d !== view.d) {
        view.d = geometry.d;
        view.path.setAttribute('d', geometry.d);
        view.start.setAttribute('cx', String(geometry.start.x));
        view.start.setAttribute('cy', String(geometry.start.y));
        view.end.setAttribute('cx', String(geometry.end.x));
        view.end.setAttribute('cy', String(geometry.end.y));
        view.label.style.transform = `translate(${geometry.mid.x}px, ${geometry.mid.y}px) translate(-50%, -50%)`;
      }
      const stateClass = `ao-pro-link is-${model.state}`;
      if (view.group.getAttribute('class') !== stateClass) view.group.setAttribute('class', stateClass);
      setText(view.role, model.label.role);
      setText(view.task, model.label.task);
      view.task.hidden = model.label.task === '';
      toggleClass(view.label, `is-${model.state}`, true);
      for (const other of ['flowing', 'waiting', 'done', 'idle'])
        if (other !== model.state) toggleClass(view.label, `is-${other}`, false);
    }
    for (const [id, view] of this.linkViews)
      if (!seen.has(id)) {
        view.group.remove();
        view.label.remove();
        this.linkViews.delete(id);
      }
  }

  private createLink(): LinkView {
    const path = svg('path', { class: 'ao-pro-link-line', fill: 'none' });
    const start = svg('circle', { class: 'ao-pro-link-port', r: 5 });
    const end = svg('circle', { class: 'ao-pro-link-port', r: 5 });
    const group = svg('g', { class: 'ao-pro-link' }, path, start, end);
    const role = h('strong', { class: 'ao-pro-link-role' });
    const task = h('span', { class: 'ao-pro-link-task' });
    return { group, path, start, end, label: h('div', { class: 'ao-pro-link-label' }, role, task), role, task, d: '' };
  }
}
