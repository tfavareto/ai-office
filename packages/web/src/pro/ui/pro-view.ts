// The Pro view: every open session of every room on one canvas, raw and code-first. Each orchestrator is a large
// terminal with its subagents around it, joined by lines that move while the subagent works. A click focuses a
// terminal (it never opens the office drawer), a double click maximizes it, a room frame's header opens the room's
// orchestration panel. It only draws what the office already knows (the snapshot) and reads the real conversations
// from the local server; nothing here runs a model.
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
import {
  buildScene,
  layoutRooms,
  type FinishedSub,
  type Scene,
  type SceneCluster,
  type SceneMemory,
} from '../model/scene';
import { directionOfKey, neighbor } from '../model/spatial';
import { CameraController } from './camera-controller';
import { CanvasLayers, type FrameModel, type LinkModel } from './canvas-layers';
import { CommandBar } from './command-bar';
import { ViewportGestures } from './gestures';
import { Listeners } from './listeners';
import { NodeDrag, type ActiveDrag, type DragTarget } from './node-drag';
import { RoomPanel } from './room-panel';
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
/** A press on a frame's header that moves less than this is a click (more is a pan of the canvas). */
const CLICK_SLOP_PX = 5;
/** Where a maximized finished subagent (no longer on the canvas) is placed while it is maximized. */
const DETACHED_RECT: Rect = { x: 0, y: 0, width: 600, height: 400 };

/** What survives the rebuild of the panels after a language change: where the camera was and which subagents it remembers. */
export interface ProSession {
  camera: Camera | null;
  memory: SceneMemory;
}

type Selection = ReturnType<AppContext['ui']['get']>['selection'];

export class ProView implements Component {
  readonly el = h('section', { class: 'ao-pro', hidden: true });
  private readonly viewport = h('div', {
    class: 'ao-pro-viewport',
    role: 'region',
    'aria-label': t('pro.canvas.label'),
  });
  private readonly world = h('div', { class: 'ao-pro-world' });
  private readonly layers: CanvasLayers;
  private readonly nodesLayer = h('div', { class: 'ao-pro-nodes' });
  private readonly maxLayer = h('div', { class: 'ao-pro-max', hidden: true });
  private readonly empty = h('p', { class: 'ao-pro-empty', hidden: true }, t('pro.canvas.empty'));
  private readonly toolbar: Toolbar;
  private readonly command: CommandBar;
  private readonly panel: RoomPanel;
  private readonly camera: CameraController;
  private readonly gestures: ViewportGestures;
  private readonly drag: NodeDrag;
  private readonly demo = new DemoTranscripts();
  private readonly nodes = new Map<string, TerminalNode>();
  private readonly agents = new Map<string, Agent>();
  /** Finished subagents folded into a pill, by id: they can still be maximized. */
  private readonly folded = new Map<string, FinishedSub>();
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly windowListeners = new Listeners();
  private memory: SceneMemory;
  private positions: ProPositions = loadPositions();
  private scene: Scene | null = null;
  private layout: Layout | null = null;
  private viewportSize = { width: 0, height: 0 };
  private active = false;
  private disposed = false;
  private needsFit = true;
  private maximizedId: string | null = null;
  private policyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSelection: string | null = null;
  private selectedFromCanvas: string | null = null;
  private lastInverse = 0;
  private framePress: { roomId: string; x: number; y: number; pointerId: number } | null = null;
  /** The room selected in the sidebar that opened the panel (cleared with it). */
  private panelFromSelection = false;

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
    this.layers = new CanvasLayers((roomId) => this.openPanel(roomId));
    this.toolbar = new Toolbar({
      fitAll: () => this.fitAll(),
      focusOrchestrator: () => this.focusOrchestrator(),
      zoomIn: () => this.zoomBy(ZOOM_STEP),
      zoomOut: () => this.zoomBy(1 / ZOOM_STEP),
      resetZoom: () => this.setZoom(1),
      toggleTheme: () => ctx.prefs.set({ proTheme: ctx.prefs.get().proTheme === 'dark' ? 'light' : 'dark' }),
      resetLayout: () => this.resetLayout(),
      toggleCommandBar: () => this.toggleCommandBar(),
    });
    this.command = new CommandBar(ctx, ctx.voice.input);
    this.panel = new RoomPanel(ctx, ctx.voice.input, {
      close: () => this.closePanel(),
      reveal: (agentId) => this.focusNode(agentId),
    });
    this.world.append(this.layers.frames, this.layers.svg, this.layers.labels, this.nodesLayer);
    this.viewport.append(this.world);
    this.el.append(this.viewport, this.empty, this.maxLayer, this.toolbar.el, this.panel.el, this.command.el);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.viewport);
    this.bindEvents();
    if (session.camera !== null) {
      this.needsFit = false;
      this.camera.jump(session.camera);
    }
  }

  /** Called when the page rebuilds its panels (a language change): nothing of this view may keep running. */
  dispose(): void {
    this.disposed = true;
    this.active = false;
    this.resizeObserver.disconnect();
    this.windowListeners.removeAll();
    this.camera.stop();
    if (this.policyTimer !== null) clearTimeout(this.policyTimer);
    this.policyTimer = null;
    this.command.dispose();
    this.panel.dispose();
    for (const node of this.nodes.values()) node.dispose();
    this.nodes.clear();
  }

  // --- events -----------------------------------------------------------------------------------------------------

  private listen<K extends keyof WindowEventMap>(type: K, listener: (event: WindowEventMap[K]) => void): void {
    this.windowListeners.on(window, type, listener);
  }

  private bindEvents(): void {
    this.viewport.addEventListener('pointerdown', (event) => {
      if (this.drag.pointerDown(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      const head = target?.closest<HTMLElement>('.ao-pro-frame-head');
      this.framePress =
        head?.dataset.roomId !== undefined && event.button === 0
          ? { roomId: head.dataset.roomId, x: event.clientX, y: event.clientY, pointerId: event.pointerId }
          : null;
      const onBackground = target === null || target.closest('.ao-pro-node') === null;
      this.gestures.pointerDown(event, onBackground);
    });
    this.viewport.addEventListener('pointerup', (event) => this.onFrameRelease(event));
    this.el.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.listen('keydown', (event) => this.onGlobalKey(event));
    this.listen('keydown', (event) => {
      if (event.key !== ' ' || !this.canPan() || isEditable(event.target)) return;
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return;
      this.gestures.setSpace(true);
      event.preventDefault();
    });
    this.listen('keyup', (event) => {
      if (event.key === ' ') this.gestures.setSpace(false);
    });
    this.listen('blur', () => this.gestures.setSpace(false));
  }

  /** The canvas has the keyboard: Pro is on and no dialog or popover is over it. */
  private canPan(): boolean {
    const ui = this.ctx.ui.get();
    return this.active && ui.dialog === null && ui.popover === null;
  }

  private onFrameRelease(event: PointerEvent): void {
    const press = this.framePress;
    this.framePress = null;
    if (press === null || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX) return;
    this.openPanel(press.roomId);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('ao-pro-node')) return;
    const id = target.dataset.nodeId;
    if (id === undefined) return;
    const direction = directionOfKey(event.key);
    if (direction !== null && this.layout !== null) {
      const nodes = [...this.layout.nodes].map(([nodeId, rect]) => ({ id: nodeId, rect }));
      const next = neighbor(nodes, id, direction);
      if (next !== null) this.focusNode(next, true);
      event.preventDefault();
    } else if (event.key === 'Enter') {
      this.toggleMaximize(id);
      event.preventDefault();
    }
  }

  /** Zoom and fit keys work wherever the focus is on the page (as long as the user is not typing). */
  private onGlobalKey(event: KeyboardEvent): void {
    if (!this.canPan() || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditable(event.target)) return;
    if (event.key === '+' || event.key === '=') this.zoomBy(ZOOM_STEP);
    else if (event.key === '-') this.zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') this.fitAll();
    else return;
    event.preventDefault();
  }

  // --- render -----------------------------------------------------------------------------------------------------

  render(): void {
    if (this.disposed) return;
    const active = this.ctx.viewMode === 'pro';
    if (active !== this.active) this.setActive(active);
    if (!active) return;
    const snapshot = this.ctx.snapshot;
    const prefs = this.ctx.prefs.get();
    this.el.dataset.theme = prefs.proTheme;
    this.command.setShown(prefs.proCommandBar);
    toggleClass(this.el, 'has-command', prefs.proCommandBar);
    toggleClass(this.el, 'has-panel', this.panel.openRoom !== null);
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
    this.panel.render(scene.rooms.find((room) => room.project.id === this.panel.openRoom));
    this.layers.setOpenRoom(this.panel.openRoom);
    this.toolbar.render({
      zoom: this.camera.camera.zoom,
      theme: prefs.proTheme,
      canReset: hasPositions(this.positions),
      commandBar: prefs.proCommandBar,
    });
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
      this.closePanel();
      for (const node of this.nodes.values()) node.setDetail('hidden', 0);
    }
  }

  private rememberAgents(scene: Scene): void {
    this.agents.clear();
    this.folded.clear();
    for (const room of scene.rooms)
      for (const cluster of room.clusters) {
        this.agents.set(cluster.main.id, cluster.main);
        for (const sub of cluster.subs) this.agents.set(sub.agent.id, sub.agent);
        for (const entry of cluster.collapsed) {
          this.folded.set(entry.agent.id, entry);
          if (!this.agents.has(entry.agent.id)) this.agents.set(entry.agent.id, entry.agent);
        }
      }
  }

  /** The layout of the scene with the user's drags, drawn into the DOM. */
  private sync(): void {
    const scene = this.scene;
    if (scene === null || this.disposed) return;
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
  }

  private syncNodes(scene: Scene, layout: Layout): void {
    const seen = new Set<string>();
    const selection = this.ctx.ui.get().selection;
    for (const room of scene.rooms)
      for (const cluster of room.clusters) {
        this.updateNode(cluster.main, cluster, true, undefined, layout.nodes.get(cluster.main.id), selection, seen);
        for (const sub of cluster.subs)
          this.updateNode(sub.agent, cluster, false, sub.finishedAt, layout.nodes.get(sub.agent.id), selection, seen);
      }
    // A finished subagent that folded into its pill can still be maximized from the pill's list.
    const detached = this.maximizedId === null ? undefined : this.folded.get(this.maximizedId);
    if (detached !== undefined && !seen.has(detached.agent.id))
      this.updateNode(detached.agent, null, false, detached.finishedAt, DETACHED_RECT, selection, seen);
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
    cluster: SceneCluster | null,
    isOrchestrator: boolean,
    finishedAt: number | undefined,
    rect: Rect | undefined,
    selection: Selection,
    seen: Set<string>,
  ): void {
    if (rect === undefined) return;
    seen.add(agent.id);
    let node = this.nodes.get(agent.id);
    if (node === undefined) {
      node = new TerminalNode(
        agent.id,
        feedSourceFor(this.ctx, this.demo, () => this.agents.get(agent.id) ?? agent),
        this.handlersFor(agent.id),
      );
      this.nodes.set(agent.id, node);
      this.nodesLayer.appendChild(node.el);
    }
    const maximized = this.maximizedId === agent.id;
    this.moveToHost(node, maximized ? this.maxLayer : this.nodesLayer);
    node.update({
      agent,
      rect,
      isOrchestrator,
      account: this.ctx.account(agent.accountId),
      finishedAt,
      selected: selection?.type === 'agent' && selection.id === agent.id,
      maximized,
      collapsed: isOrchestrator && cluster !== null ? cluster.collapsed : [],
    });
  }

  /** Moves a terminal between the canvas and the maximized layer, keeping its scroll and the keyboard focus. */
  private moveToHost(node: TerminalNode, host: HTMLElement): void {
    if (node.el.parentElement === host) return;
    const focused = document.activeElement;
    const hadFocus = focused instanceof HTMLElement && node.el.contains(focused) ? focused : null;
    node.rememberScroll();
    host.appendChild(node.el);
    node.restoreScroll();
    hadFocus?.focus({ preventScroll: true });
  }

  private frameModels(scene: Scene, layout: Layout): FrameModel[] {
    const light = this.ctx.prefs.get().proTheme === 'light';
    return layout.frames.flatMap((frame) => {
      const room = scene.rooms.find((candidate) => candidate.project.id === frame.roomId);
      if (room === undefined) return [];
      const agents = room.clusters.flatMap((cluster) => [cluster.main, ...cluster.subs.map((sub) => sub.agent)]);
      const working = agents.filter((agent) => agent.status === 'working').length;
      const waiting = agents.filter((agent) => agent.status === 'waiting').length;
      return [
        {
          roomId: frame.roomId,
          name: room.project.name,
          color: roomColor(room.project.seed, light ? 42 : 60),
          rect: frame.rect,
          meta: t('pro.frame.meta', { sessions: room.clusters.length, working, waiting }),
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

  /** The part of the screen the canvas may use: inside the sidebar, the room panel, the top bar and the command bar. */
  private area(): Area {
    const ui = this.ctx.ui.get();
    const insets = computeInsets({
      sidebarOpen: ui.sidebarOpen,
      drawerOpen: this.panel.openRoom !== null,
      feedOpen: false,
      narrow: ui.narrow,
      pro: true,
      commandBar: this.ctx.prefs.get().proCommandBar,
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
  }

  fitAll(): void {
    const bounds = this.layout?.bounds;
    if (bounds === null || bounds === undefined) return;
    this.camera.glideTo(fitCamera(bounds, this.area(), FIT_PADDING, 1));
  }

  /** Centers the orchestrator of the selected agent (or the first busy one) with its subagents around it. */
  focusOrchestrator(): void {
    const scene = this.scene;
    if (this.layout === null || scene === null) return;
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

  /** Brings a terminal into view (the sidebar, the room panel or the arrow keys). */
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

  // --- policy: what loads and polls --------------------------------------------------------------------------------

  private schedulePolicy(): void {
    if (this.policyTimer !== null || this.disposed) return;
    this.policyTimer = setTimeout(() => {
      this.policyTimer = null;
      this.applyPolicy();
    }, POLICY_DELAY_MS);
  }

  private applyPolicy(): void {
    const layout = this.layout;
    if (layout === null || !this.active || this.disposed) return;
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
        ? this.maximizedPlan()
        : planTerminals({ nodes: policyNodes, visible, zoom: camera.zoom, paused: !this.ctx.isLocal });
    for (const [id, node] of this.nodes) {
      const policy = plan.get(id) ?? { detail: 'hidden' as const, pollMs: 0 };
      node.setDetail(policy.detail, policy.pollMs);
    }
  }

  /** While a terminal is maximized only it reads its conversation; the canvas behind it rests. */
  private maximizedPlan(): Map<string, NodePolicy> {
    const plan = new Map<string, NodePolicy>();
    const id = this.maximizedId;
    const agent = id === null ? undefined : this.agents.get(id);
    if (id === null || agent === undefined) return plan;
    const finished = agent.status === 'done' || agent.status === 'offline' || this.folded.has(id);
    plan.set(
      id,
      this.ctx.isLocal
        ? { detail: 'live', pollMs: pollFor(displayStatus(agent), finished) }
        : { detail: 'summary', pollMs: 0 },
    );
    return plan;
  }

  // --- selection, maximize, room panel ----------------------------------------------------------------------------

  /** A selection made elsewhere (the sidebar, the inbox): an agent brings its terminal into view, a room opens its panel. */
  private followSelection(): void {
    const selection = this.ctx.ui.get().selection;
    const key = selection === null ? null : `${selection.type}:${selection.id}`;
    if (key === this.lastSelection) return;
    this.lastSelection = key;
    this.command.followSelection();
    if (selection?.type === 'room') {
      this.panelFromSelection = true;
      this.openPanel(selection.id);
      return;
    }
    const id = selection?.type === 'agent' ? selection.id : null;
    if (id === null || id === this.selectedFromCanvas) return;
    // The layout of a new agent may not exist yet; try again on the next render in that case.
    if (this.layout?.nodes.has(id) === true) this.focusNode(id);
    else this.lastSelection = null;
  }

  private handlersFor(id: string): NodeHandlers {
    return {
      maximize: () => this.toggleMaximize(id),
      copySessionId: () => {
        const agent = this.agents.get(id);
        if (agent !== undefined) this.ctx.copy(agent.sessionId, t('pro.node.copied'));
      },
      select: () => {
        if (this.ctx.agent(id) === undefined) return;
        this.selectedFromCanvas = id;
        this.ctx.selectAgent(id);
      },
      openFinished: (agent) => {
        this.maximizedId = agent.id;
        this.render();
        this.nodes.get(agent.id)?.el.focus({ preventScroll: true });
      },
    };
  }

  private toggleMaximize(id: string): void {
    this.maximizedId = this.maximizedId === id ? null : id;
    this.render();
  }

  private openPanel(roomId: string): void {
    if (this.panel.openRoom === roomId) {
      this.panel.open(roomId);
      return;
    }
    this.panel.open(roomId);
    this.render();
  }

  private closePanel(): void {
    const roomId = this.panel.openRoom;
    if (roomId === null) return;
    this.panel.close();
    this.layers.setOpenRoom(null);
    toggleClass(this.el, 'has-panel', false);
    const selection = this.ctx.ui.get().selection;
    if (this.panelFromSelection && selection?.type === 'room' && selection.id === roomId) this.ctx.clearSelection();
    this.panelFromSelection = false;
    // The keyboard goes back to the header that opened it.
    if (this.active) this.layers.frameHead(roomId)?.focus({ preventScroll: true });
  }

  /** Esc restores a maximized terminal first, then closes the room panel. Returns whether it used the key. */
  handleEscape(): boolean {
    // A dialog or a popover over the canvas closes first.
    if (!this.canPan()) return false;
    if (this.maximizedId !== null) {
      const id = this.maximizedId;
      this.maximizedId = null;
      this.render();
      this.nodes.get(id)?.el.focus({ preventScroll: true });
      return true;
    }
    if (this.panel.openRoom !== null) {
      this.closePanel();
      this.ctx.refresh();
      return true;
    }
    return false;
  }

  /** The "N" key and the toolbar switch: shows the command bar (with the cursor in it) or hides it. */
  toggleCommandBar(): void {
    const shown = !this.ctx.prefs.get().proCommandBar;
    this.ctx.prefs.set({ proCommandBar: shown });
    this.command.setShown(shown);
    this.command.render();
    if (shown) this.command.focus();
    this.ctx.refresh();
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
  get debug(): { zoom: number; nodes: number; live: number; resting: number; elements: number } {
    const values = [...this.nodes.values()];
    return {
      zoom: this.camera.camera.zoom,
      nodes: this.nodes.size,
      live: values.filter((node) => node.el.classList.contains('lod-live')).length,
      resting: values.filter((node) => node.el.classList.contains('lod-summary')).length,
      elements: this.el.getElementsByTagName('*').length,
    };
  }
}
