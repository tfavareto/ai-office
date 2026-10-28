// The Pro view: every open session of every room on one canvas. Each orchestrator is a large terminal with its
// subagents around it, joined by lines that move while the subagent works. It only draws what the office already knows
// (the snapshot) and reads the real conversations from the local server; nothing here runs a model.
import type { Agent } from '@ai-office/shared';
import { t } from '../../i18n';
import type { AppContext, Component } from '../../ui/context';
import { h, isEditable, toggleClass } from '../../ui/dom';
import { computeInsets } from '../../ui/layout';
import { displayStatus } from '../../ui/model/status';
import { roomColor } from '../../ui/model/rooms';
import {
  EMPTY_POSITIONS,
  hasPositions,
  loadPositions,
  savePositions,
  withClusterOffset,
  withPanelOffset,
  type ProPositions,
} from '../model/positions';
import {
  MAX_ZOOM,
  ZOOM_STEP,
  areaCenter,
  centerCamera,
  clamp,
  fitCamera,
  revealRect,
  unionRects,
  visibleWorldRect,
  type Area,
  type Camera,
  type Point,
  type Rect,
} from '../model/geometry';
import { computeLayout, type Layout } from '../model/layout';
import { linkLabel, linkState } from '../model/links';
import { pollFor, planTerminals, VISIBLE_MARGIN_PX, type NodePolicy, type PolicyNode } from '../model/policy';
import { buildScene, layoutRooms, type Scene, type SceneCluster, type SceneMemory } from '../model/scene';
import { directionOfKey, neighbor } from '../model/spatial';
import { CameraController } from './camera-controller';
import { CanvasLayers, type FrameModel, type LinkModel } from './canvas-layers';
import { CommandBar } from './command-bar';
import { ViewportGestures } from './gestures';
import { Minimap } from './minimap';
import { NodeDrag, type ActiveDrag, type DragTarget } from './node-drag';
import { TerminalNode, type NodeHandlers } from './terminal-node';
import { Toolbar } from './toolbar';
import { DemoTranscripts, feedSourceFor } from './transcript-source';

/** A terminal revealed from the sidebar or the keyboard is brought to at least this zoom. */
const FOCUS_MIN_ZOOM = 0.72;
const FIT_PADDING = 40;
/** Height of the tools strip under the top bar. */
const TOOLBAR_CLEARANCE = 48;
const POLICY_DELAY_MS = 120;
/** Below this zoom the lines' labels and the grid are left out. */
const LABEL_MIN_ZOOM = 0.34;
const GRID_PITCH = 28;
const GRID_MIN_PITCH_PX = 9;

/** What survives the rebuild of the panels after a language change: where the camera was and which subagents it remembers. */
export interface ProSession {
  camera: Camera | null;
  memory: SceneMemory;
}

export class ProView implements Component {
  readonly el = h('section', { class: 'ao-pro', hidden: true });
  private readonly viewport = h('div', {
    class: 'ao-pro-viewport',
    role: 'region',
    'aria-label': t('pro.canvas.label'),
  });
  private readonly world = h('div', { class: 'ao-pro-world' });
  private readonly layers = new CanvasLayers();
  private readonly nodesLayer = h('div', { class: 'ao-pro-nodes' });
  private readonly maxLayer = h('div', { class: 'ao-pro-max', hidden: true });
  private readonly empty = h('p', { class: 'ao-pro-empty', hidden: true }, t('pro.canvas.empty'));
  private readonly toolbar: Toolbar;
  private readonly minimap: Minimap;
  private readonly command: CommandBar;
  private readonly camera: CameraController;
  private readonly gestures: ViewportGestures;
  private readonly drag: NodeDrag;
  private readonly demo = new DemoTranscripts();
  private readonly nodes = new Map<string, TerminalNode>();
  private readonly agents = new Map<string, Agent>();
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private memory: SceneMemory;
  private positions: ProPositions = loadPositions();
  private scene: Scene | null = null;
  private layout: Layout | null = null;
  private viewportSize = { width: 0, height: 0 };
  private active = false;
  private needsFit = true;
  private maximizedId: string | null = null;
  private policyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSelection: string | null = null;
  private selectedFromCanvas: string | null = null;
  private lastInverse = 0;

  constructor(
    private readonly ctx: AppContext,
    private readonly session: ProSession,
  ) {
    this.memory = session.memory;
    this.camera = new CameraController(
      (camera) => {
        this.session.camera = camera;
        this.applyCamera(camera);
      },
      () => this.applyPolicy(),
      () => !this.reducedMotion.matches,
    );
    this.gestures = new ViewportGestures(this.viewport, this.camera, () => this.schedulePolicy());
    this.drag = new NodeDrag(this.viewport, {
      resolve: (id, shift) => this.resolveDrag(id, shift),
      zoom: () => this.camera.camera.zoom,
      onMove: (drag) => this.onDragMove(drag),
      onEnd: (drag, moved) => this.onDragEnd(drag, moved),
    });
    this.toolbar = new Toolbar({
      fitAll: () => this.fitAll(),
      focusOrchestrator: () => this.focusOrchestrator(),
      zoomIn: () => this.zoomBy(ZOOM_STEP),
      zoomOut: () => this.zoomBy(1 / ZOOM_STEP),
      resetZoom: () => this.setZoom(1),
      toggleTheme: () => ctx.prefs.set({ proTheme: ctx.prefs.get().proTheme === 'dark' ? 'light' : 'dark' }),
      resetLayout: () => this.resetLayout(),
    });
    this.minimap = new Minimap((point) => this.centerOn(point));
    this.command = new CommandBar(ctx, ctx.voice.input);
    this.world.append(this.layers.frames, this.layers.svg, this.layers.labels, this.nodesLayer);
    this.viewport.append(this.world);
    this.el.append(this.viewport, this.empty, this.maxLayer, this.toolbar.el, this.minimap.el, this.command.el);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.viewport);
    this.bindEvents();
    if (session.camera !== null) {
      this.needsFit = false;
      this.camera.jump(session.camera);
    }
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.command.dispose();
    for (const node of this.nodes.values()) node.dispose();
    if (this.policyTimer !== null) clearTimeout(this.policyTimer);
  }

  // --- events -----------------------------------------------------------------------------------------------------

  private bindEvents(): void {
    this.viewport.addEventListener('pointerdown', (event) => {
      if (this.drag.pointerDown(event)) return;
      const onBackground = !(event.target instanceof Element) || event.target.closest('.ao-pro-node') === null;
      this.gestures.pointerDown(event, onBackground);
    });
    this.el.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keydown', (event) => this.onGlobalKey(event));
    window.addEventListener('keydown', (event) => {
      if (
        event.key === ' ' &&
        this.active &&
        !isEditable(event.target) &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        this.gestures.setSpace(true);
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => {
      if (event.key === ' ') this.gestures.setSpace(false);
    });
    window.addEventListener('blur', () => this.gestures.setSpace(false));
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains('ao-pro-node')) {
      const id = target.dataset.nodeId;
      const direction = directionOfKey(event.key);
      if (id !== undefined && direction !== null && this.layout !== null) {
        const nodes = [...this.layout.nodes].map(([nodeId, rect]) => ({ id: nodeId, rect }));
        const next = neighbor(nodes, id, direction);
        if (next !== null) this.focusNode(next, true);
        event.preventDefault();
        return;
      }
      if (id !== undefined && event.key === 'Enter') {
        this.toggleMaximize(id);
        event.preventDefault();
        return;
      }
    }
  }

  /** Zoom and fit keys work wherever the focus is on the page (as long as the user is not typing). */
  private onGlobalKey(event: KeyboardEvent): void {
    if (!this.active || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditable(event.target)) return;
    if (event.key === '+' || event.key === '=') this.zoomBy(ZOOM_STEP);
    else if (event.key === '-') this.zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') this.fitAll();
    else return;
    event.preventDefault();
  }

  // --- render -----------------------------------------------------------------------------------------------------

  render(): void {
    const active = this.ctx.viewMode === 'pro';
    if (active !== this.active) this.setActive(active);
    if (!active) return;
    const snapshot = this.ctx.snapshot;
    const theme = this.ctx.prefs.get().proTheme;
    this.el.dataset.theme = theme;
    if (snapshot === null) return;
    this.demo.observe(snapshot);
    const scene = buildScene(snapshot, this.memory, this.ctx.now());
    this.memory = scene.memory;
    this.session.memory = scene.memory;
    this.scene = scene;
    this.rememberAgents(scene);
    this.followSelection();
    this.sync();
    this.command.render();
    this.toolbar.render({ zoom: this.camera.camera.zoom, theme, canReset: hasPositions(this.positions) });
    toggleClass(this.el, 'is-empty', scene.rooms.length === 0);
    this.empty.hidden = scene.rooms.length > 0;
  }

  private setActive(active: boolean): void {
    this.active = active;
    this.el.hidden = !active;
    if (active) {
      this.needsFit = this.session.camera === null;
      this.measure();
    } else {
      this.maximizedId = null;
      for (const node of this.nodes.values()) node.setDetail('hidden', 0);
    }
  }

  private rememberAgents(scene: Scene): void {
    this.agents.clear();
    for (const room of scene.rooms)
      for (const cluster of room.clusters) {
        this.agents.set(cluster.main.id, cluster.main);
        for (const sub of cluster.subs) this.agents.set(sub.agent.id, sub.agent);
      }
  }

  /** The layout of the scene with the user's drags, drawn into the DOM. */
  private sync(): void {
    const scene = this.scene;
    if (scene === null) return;
    const layout = computeLayout(layoutRooms(scene), this.liveOffsets());
    this.layout = layout;
    this.syncNodes(scene, layout);
    this.layers.syncFrames(this.frameModels(scene, layout));
    this.layers.syncLinks(this.linkModels(scene, layout));
    if (this.needsFit && layout.bounds !== null && this.area().width > 0) {
      this.needsFit = false;
      this.camera.jump(fitCamera(layout.bounds, this.area(), FIT_PADDING, 1));
    }
    this.applyPolicy();
    this.drawMinimap();
  }

  private syncNodes(scene: Scene, layout: Layout): void {
    const seen = new Set<string>();
    const selection = this.ctx.ui.get().selection;
    for (const room of scene.rooms) {
      for (const cluster of room.clusters) {
        this.updateNode(cluster.main, cluster, true, undefined, room.project.name, layout, selection, seen);
        for (const sub of cluster.subs)
          this.updateNode(sub.agent, cluster, false, sub.finishedAt, room.project.name, layout, selection, seen);
      }
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.dispose();
      node.el.remove();
      this.nodes.delete(id);
      if (this.maximizedId === id) this.maximizedId = null;
    }
    this.maxLayer.hidden = this.maximizedId === null;
    toggleClass(this.el, 'has-maximized', this.maximizedId !== null);
  }

  private updateNode(
    agent: Agent,
    cluster: SceneCluster,
    isOrchestrator: boolean,
    finishedAt: number | undefined,
    roomName: string,
    layout: Layout,
    selection: ReturnType<AppContext['ui']['get']>['selection'],
    seen: Set<string>,
  ): void {
    const rect = layout.nodes.get(agent.id);
    if (rect === undefined) return;
    seen.add(agent.id);
    let node = this.nodes.get(agent.id);
    if (node === undefined) {
      node = new TerminalNode(
        agent.id,
        feedSourceFor(this.ctx, this.demo, () => this.agents.get(agent.id) ?? agent),
        this.handlersFor(agent.id),
        () => undefined,
      );
      this.nodes.set(agent.id, node);
      this.nodesLayer.appendChild(node.el);
    }
    const maximized = this.maximizedId === agent.id;
    const host = maximized ? this.maxLayer : this.nodesLayer;
    if (node.el.parentElement !== host) {
      node.rememberScroll();
      host.appendChild(node.el);
      node.restoreScroll();
    }
    node.update({
      agent,
      rect,
      isOrchestrator,
      roomName,
      account: this.ctx.account(agent.accountId),
      finishedAt,
      selected: selection?.type === 'agent' && selection.id === agent.id,
      maximized,
      collapsed: isOrchestrator ? cluster.collapsed : [],
      now: this.ctx.now(),
    });
  }

  private frameModels(scene: Scene, layout: Layout): FrameModel[] {
    return layout.frames.flatMap((frame) => {
      const room = scene.rooms.find((candidate) => candidate.project.id === frame.roomId);
      if (room === undefined) return [];
      const agents = room.clusters.flatMap((cluster) => [cluster.main, ...cluster.subs.map((sub) => sub.agent)]);
      const working = agents.filter((agent) => agent.status === 'working').length;
      return [
        {
          roomId: frame.roomId,
          name: room.project.name,
          color: roomColor(room.project.seed, this.ctx.prefs.get().proTheme === 'light' ? 42 : 60),
          rect: frame.rect,
          meta: t('pro.frame.meta', { agents: agents.length, working }),
        },
      ];
    });
  }

  private linkModels(scene: Scene, layout: Layout): LinkModel[] {
    const links: LinkModel[] = [];
    for (const room of scene.rooms)
      for (const cluster of room.clusters) {
        const from = layout.nodes.get(cluster.main.id);
        if (from === undefined) continue;
        for (const sub of cluster.subs) {
          const to = layout.nodes.get(sub.agent.id);
          if (to === undefined) continue;
          links.push({
            id: sub.agent.id,
            from,
            to,
            state: linkState(sub.agent, sub.finishedAt !== undefined),
            label: linkLabel(sub.agent),
          });
        }
      }
    return links;
  }

  // --- camera -----------------------------------------------------------------------------------------------------

  private measure(): void {
    this.viewportSize = { width: this.viewport.clientWidth, height: this.viewport.clientHeight };
  }

  private onResize(): void {
    this.measure();
    if (this.active) this.sync();
  }

  /** The part of the screen the canvas may use: inside the sidebar, the drawer, the top bar and the command bar. */
  private area(): Area {
    const ui = this.ctx.ui.get();
    const insets = computeInsets({
      sidebarOpen: ui.sidebarOpen,
      drawerOpen: ui.selection !== null,
      feedOpen: ui.feedOpen,
      narrow: ui.narrow,
      pro: true,
    });
    // The tools sit at the top left of the canvas: the picture starts below them.
    const top = insets.top + TOOLBAR_CLEARANCE;
    return {
      x: insets.left,
      y: top,
      width: Math.max(0, this.viewportSize.width - insets.left - insets.right),
      height: Math.max(0, this.viewportSize.height - top - insets.bottom),
    };
  }

  private applyCamera(camera: Camera): void {
    this.world.style.transform = `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`;
    const inverse = 1 / camera.zoom;
    if (Math.abs(inverse - this.lastInverse) / inverse > 0.02) {
      this.lastInverse = inverse;
      this.el.style.setProperty('--ao-pro-inv', inverse.toFixed(3));
      toggleClass(this.el, 'lod-far', camera.zoom < LABEL_MIN_ZOOM);
    }
    const pitch = GRID_PITCH * camera.zoom;
    const showGrid = pitch >= GRID_MIN_PITCH_PX;
    this.viewport.style.backgroundSize = showGrid ? `${pitch}px ${pitch}px` : '0 0';
    this.viewport.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
    this.schedulePolicy();
    this.drawMinimapSoon();
  }

  fitAll(): void {
    const bounds = this.layout?.bounds;
    if (bounds === null || bounds === undefined) return;
    this.camera.glideTo(fitCamera(bounds, this.area(), FIT_PADDING, 1));
  }

  /** Centers the orchestrator of the selected agent (or the first one) with its subagents around it. */
  focusOrchestrator(): void {
    const layout = this.layout;
    const scene = this.scene;
    if (layout === null || scene === null) return;
    const selection = this.ctx.ui.get().selection;
    const clusters = scene.rooms.flatMap((room) => room.clusters);
    const cluster =
      clusters.find(
        (candidate) =>
          selection?.type === 'agent' &&
          (candidate.main.id === selection.id || candidate.subs.some((sub) => sub.agent.id === selection.id)),
      ) ??
      clusters.find((candidate) => candidate.main.status === 'working') ??
      clusters[0];
    if (cluster !== undefined) this.focusCluster(cluster.main.id);
  }

  private focusCluster(mainId: string): void {
    const scene = this.scene;
    const layout = this.layout;
    if (scene === null || layout === null) return;
    const cluster = scene.rooms.flatMap((room) => room.clusters).find((candidate) => candidate.main.id === mainId);
    const rects = [mainId, ...(cluster?.subs.map((sub) => sub.agent.id) ?? [])]
      .map((id) => layout.nodes.get(id))
      .filter((rect): rect is Rect => rect !== undefined);
    const bounds = unionRects(rects);
    if (bounds !== null) this.camera.glideTo(fitCamera(bounds, this.area(), FIT_PADDING, 1));
  }

  /** Brings a terminal into view (the sidebar, a click on the minimap or the arrow keys). */
  focusNode(id: string, focusElement = false): void {
    const rect = this.layout?.nodes.get(id);
    if (rect === undefined) return;
    const camera = this.camera.destination;
    const area = this.area();
    if (camera.zoom < FOCUS_MIN_ZOOM) this.camera.glideTo(centerCamera(rect, area, FOCUS_MIN_ZOOM));
    else this.camera.glideTo(revealRect(camera, rect, area, FIT_PADDING));
    if (focusElement) this.nodes.get(id)?.el.focus({ preventScroll: true });
  }

  zoomBy(factor: number): void {
    const center = areaCenter(this.area());
    this.camera.zoomBy(factor, center);
  }

  private setZoom(zoom: number): void {
    const current = this.camera.destination;
    this.zoomBy(clamp(zoom, 0.01, MAX_ZOOM) / current.zoom);
  }

  /** The minimap was pressed: put that world point at the center of the area. */
  private centerOn(world: Point): void {
    const camera = this.camera.destination;
    const center = areaCenter(this.area());
    this.camera.jump({ zoom: camera.zoom, x: center.x - world.x * camera.zoom, y: center.y - world.y * camera.zoom });
  }

  // --- policy: what loads and polls --------------------------------------------------------------------------------

  private schedulePolicy(): void {
    if (this.policyTimer !== null) return;
    this.policyTimer = setTimeout(() => {
      this.policyTimer = null;
      this.applyPolicy();
    }, POLICY_DELAY_MS);
  }

  private applyPolicy(): void {
    const layout = this.layout;
    if (layout === null || !this.active) return;
    const camera = this.camera.camera;
    const full: Area = { x: 0, y: 0, width: this.viewportSize.width, height: this.viewportSize.height };
    const visible = visibleWorldRect(camera, full, VISIBLE_MARGIN_PX / camera.zoom);
    const selection = this.ctx.ui.get().selection;
    const policyNodes: PolicyNode[] = [];
    for (const [id, rect] of layout.nodes) {
      const agent = this.agents.get(id);
      if (agent === undefined) continue;
      policyNodes.push({
        id,
        rect,
        status: displayStatus(agent),
        focused: (selection?.type === 'agent' && selection.id === id) || this.maximizedId === id,
        finished: agent.status === 'done' || agent.status === 'offline',
        isOrchestrator: agent.kind === 'main',
      });
    }
    const plan =
      this.maximizedId !== null
        ? this.maximizedPlan(policyNodes)
        : planTerminals({
            nodes: policyNodes,
            visible,
            zoom: camera.zoom,
            paused: !this.ctx.isLocal,
          });
    for (const [id, node] of this.nodes) {
      const policy = plan.get(id) ?? { detail: 'hidden' as const, pollMs: 0 };
      node.setDetail(policy.detail, policy.pollMs);
    }
  }

  /** While a terminal is maximized only it works; the canvas behind it rests. */
  private maximizedPlan(nodes: readonly PolicyNode[]): Map<string, NodePolicy> {
    const plan = new Map<string, NodePolicy>();
    for (const node of nodes)
      plan.set(
        node.id,
        node.id === this.maximizedId && this.ctx.isLocal
          ? { detail: 'live', pollMs: pollFor(node.status, node.finished) }
          : { detail: node.id === this.maximizedId ? 'summary' : 'hidden', pollMs: 0 },
      );
    return plan;
  }

  // --- minimap ----------------------------------------------------------------------------------------------------

  private minimapTimer: ReturnType<typeof setTimeout> | null = null;

  private drawMinimapSoon(): void {
    if (this.minimapTimer !== null) return;
    this.minimapTimer = setTimeout(() => {
      this.minimapTimer = null;
      this.drawMinimap();
    }, 60);
  }

  private drawMinimap(): void {
    const layout = this.layout;
    if (layout === null || !this.active) return;
    const camera = this.camera.camera;
    const view = visibleWorldRect(camera, this.area());
    this.minimap.draw(
      {
        frames: layout.frames.map((frame) => ({
          rect: frame.rect,
          color: roomColor(this.roomSeed(frame.roomId), 58),
        })),
        nodes: [...layout.nodes].map(([id, rect]) => ({ rect, active: this.agents.get(id)?.status === 'working' })),
        view,
      },
      this.ctx.prefs.get().proTheme === 'dark',
    );
  }

  private roomSeed(roomId: string): number {
    return this.scene?.rooms.find((room) => room.project.id === roomId)?.project.seed ?? 0;
  }

  // --- selection, maximize ----------------------------------------------------------------------------------------

  /** A selection made elsewhere (the sidebar, the inbox) brings its terminal into view and aims the command bar. */
  private followSelection(): void {
    const selection = this.ctx.ui.get().selection;
    const id = selection?.type === 'agent' ? selection.id : null;
    if (id === this.lastSelection) return;
    this.lastSelection = id;
    this.command.followSelection();
    if (id === null || id === this.selectedFromCanvas) return;
    // The layout of a new agent may not exist yet; try again on the next render in that case.
    if (this.layout?.nodes.has(id) === true) this.focusNode(id);
    else this.lastSelection = null;
  }

  private handlersFor(id: string): NodeHandlers {
    return {
      maximize: () => this.toggleMaximize(id),
      openInTerminal: () => {
        const agent = this.agents.get(id);
        if (agent !== undefined) this.ctx.openTerminalForAgent(agent);
      },
      showInOffice: () => {
        this.ctx.setViewMode('basic');
        if (this.ctx.agent(id) !== undefined) this.ctx.selectAgent(id, { focus: true });
      },
      copySessionId: () => {
        const agent = this.agents.get(id);
        if (agent !== undefined) this.ctx.copy(agent.sessionId, t('pro.node.copied'));
      },
      select: () => {
        if (this.ctx.agent(id) === undefined) return;
        this.selectedFromCanvas = id;
        this.ctx.selectAgent(id);
      },
      openFinished: (agent) => this.ctx.openTerminalForAgent(agent),
    };
  }

  private toggleMaximize(id: string): void {
    this.maximizedId = this.maximizedId === id ? null : id;
    this.render();
  }

  /** Esc closes a maximized terminal first. Returns whether it used the key. */
  handleEscape(): boolean {
    if (!this.active || this.maximizedId === null) return false;
    this.maximizedId = null;
    this.render();
    return true;
  }

  /** The "N" key: the prompt of the command bar gets the focus. */
  focusPrompt(): void {
    this.command.focus();
  }

  // --- dragging ---------------------------------------------------------------------------------------------------

  private liveOffsets(): { clusters: Record<string, Point>; panels: Record<string, Point> } {
    const drag = this.drag.current;
    const clusters: Record<string, Point> = { ...this.positions.clusters };
    const panels: Record<string, Point> = { ...this.positions.panels };
    if (drag !== null && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
      const target = drag.kind === 'cluster' ? clusters : panels;
      target[drag.id] = { x: drag.base.x + drag.delta.x, y: drag.base.y + drag.delta.y };
    }
    return { clusters, panels };
  }

  private resolveDrag(nodeId: string, shift: boolean): DragTarget | null {
    if (this.maximizedId !== null) return null;
    const agent = this.agents.get(nodeId);
    if (agent === undefined) return null;
    const wholeCluster = agent.kind === 'main' && !shift;
    return wholeCluster
      ? { kind: 'cluster', id: nodeId, base: this.positions.clusters[nodeId] ?? { x: 0, y: 0 } }
      : { kind: 'panel', id: nodeId, base: this.positions.panels[nodeId] ?? { x: 0, y: 0 } };
  }

  private onDragMove(_drag: ActiveDrag): void {
    toggleClass(this.el, 'is-dragging', true);
    this.sync();
  }

  private onDragEnd(drag: ActiveDrag, moved: boolean): void {
    toggleClass(this.el, 'is-dragging', false);
    if (!moved) return;
    const offset = { x: drag.base.x + drag.delta.x, y: drag.base.y + drag.delta.y };
    this.positions =
      drag.kind === 'cluster'
        ? withClusterOffset(this.positions, drag.id, offset)
        : withPanelOffset(this.positions, drag.id, offset);
    savePositions(this.positions);
    this.sync();
  }

  private resetLayout(): void {
    this.positions = EMPTY_POSITIONS;
    savePositions(this.positions);
    this.sync();
    this.fitAll();
  }

  /** Numbers for the debug hook (`window.aiOffice.debug`). */
  get debug(): { zoom: number; nodes: number; live: number } {
    return {
      zoom: this.camera.camera.zoom,
      nodes: this.nodes.size,
      live: [...this.nodes.values()].filter((node) => node.el.classList.contains('lod-live')).length,
    };
  }
}
