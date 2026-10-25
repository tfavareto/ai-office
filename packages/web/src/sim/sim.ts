import type { Agent, OfficeSnapshot } from '@ai-office/shared';
import { computeBuilding } from '../layout/building';
import { isWalkable, nearestWalkable } from '../layout/grid';
import { clamp, hash32 } from '../layout/rng';
import type { AreaLayout, BuildingLayout, RoomSpec, Spot, TilePos } from '../layout/types';
import { Actor, approach, dirFromVector } from './actor';
import { type DeskTarget, emptyDeskAt } from './desks';
import { hireAgentId, placeholderAgent, waitingHires, withHireProjects } from './hires';
import { activityImportance, BubbleManager, clipText, ALERT_IMPORTANCE, type Bubble, type BubbleSpec } from './bubbles';
import { findPath, smoothPath, type Vec } from './path';
import { RoomManager, type RoomMove, type RoomState } from './rooms';
import { SpotBook } from './spots';
import { DEFAULT_SIM_OPTIONS, TICK, type Character, type SimOptions } from './types';
import { Activities } from './activities';
import { Party } from './party';
import { EncounterRunner } from './runner';
import { SHELL_STAGE_POSES, hasForegroundShell, meetingTiles, scheduleStretch, shellStage, startWave } from './social';
import type { SimEffect } from './effects';
import { seatedPoseFor, workMood } from './work';
import { pingPongTables, type PingPongTable } from './pingpong';

const SPEED: Record<SimOptions['liveliness'], number> = { calm: 1.6, normal: 2.0, lively: 2.5 };
const ROOM_READY = 0.7;
/** Seconds a departing subagent waits for the farewell handshake. */
const FAREWELL_PATIENCE = 10;
const MAX_STEPS_PER_ADVANCE = 12;

interface ElevatorState {
  hold: number;
  openness: number;
  nextFree: number;
}

export interface SimStats {
  actors: number;
  walking: number;
}

/** Everything the building depends on. */
const layoutKey = (specs: readonly RoomSpec[]): string => JSON.stringify(specs);

const centerOf = (t: TilePos): Vec => ({ x: t.x + 0.5, y: t.y + 0.5 });

/** Deterministic office simulation: people derived from snapshot agents, rooms, bubbles. No DOM, fixed 30 Hz tick. */
export class OfficeSim {
  readonly rooms = new RoomManager();
  readonly spots = new SpotBook();
  readonly bubbleManager = new BubbleManager();
  building: BuildingLayout;
  layoutVersion = 0;
  /** Simulation time in seconds. */
  time = 0;
  options: SimOptions = { ...DEFAULT_SIM_OPTIONS };

  private readonly seed: number;
  private actors = new Map<string, Actor>();
  private list: Actor[] = [];
  private areaIndex = new Int16Array(0);
  private areaIds: string[] = [];
  private elevators: ElevatorState[] = [];
  private accumulator = 0;
  private firstSnapshot = true;
  private serverBase = 0;
  private serverBaseTime = 0;
  private bubbleList: readonly Bubble[] = [];
  private tickCount = 0;
  /** What the current building was computed from. */
  private builtKey = '';
  private readonly party: Party;
  private readonly runner: EncounterRunner;
  private readonly activities: Activities;
  /** Main agents with at least one subagent working (they look like they are delegating). */
  private parentsWithWork = new Set<string>();

  constructor(seed = 1) {
    this.seed = seed;
    this.building = computeBuilding([]);
    this.relayout();
    this.party = new Party(seed, {
      now: () => this.time,
      options: () => this.options,
      actor: (id) => this.actors.get(id),
      actors: () => this.list,
      areaRect: (areaId) => this.building.areas.find((x) => x.id === areaId)?.rect ?? null,
      bubble: (a, b) => this.offerBubble(a, b),
    });
    this.activities = new Activities({
      now: () => this.time,
      options: () => this.options,
      spots: this.spots,
      actors: () => this.list,
      actor: (id) => this.actors.get(id),
      walk: (a, tile) => this.startWalk(a, tile),
      goHome: (a) => this.goHome(a),
      walkToExit: (a) => this.walkToExit(a),
      bubble: (a, spec) => this.offerBubble(a, spec),
    });
    this.runner = new EncounterRunner({
      now: () => this.time,
      actor: (id) => this.actors.get(id),
      walk: (a, tile) => this.startWalk(a, tile),
      goHome: (a) => this.goHome(a),
      meetingTiles: (x, y) => meetingTiles(this.building.grid, x, y),
      bubble: (a, icon, ttl) =>
        this.offerBubble(a, { text: '', icon, importance: 40, sticky: false, ttl, ambient: true }),
      spark: (x, y) => this.party.effects.push({ type: 'spark', x, y, seed: this.tickCount }),
    });
  }

  /** Ping-pong tables and whether a rally is on (the renderers animate the ball). */
  pingPongTables(): PingPongTable[] {
    return pingPongTables(this.spots, (id) => this.actors.get(id));
  }

  /** Effects (confetti, sparks, sounds) requested since the last call. The world that owns this sim draws them. */
  takeEffects(): readonly SimEffect[] {
    return this.party.effects.take();
  }

  get characters(): readonly Character[] {
    return this.list;
  }

  get bubbles(): readonly Bubble[] {
    return this.bubbleList;
  }

  stats(): SimStats {
    return { actors: this.list.length, walking: this.list.filter((a) => a.moving).length };
  }

  character(id: string): Character | undefined {
    return this.actors.get(id);
  }

  /** The empty desk under a floor-plan position (tile units), if any. */
  emptyDeskAt(x: number, y: number): DeskTarget | null {
    return emptyDeskAt(this.building, this.spots, this.rooms, x, y);
  }

  /** Estimated server clock (ms). */
  serverNow(): number {
    return this.serverBase + (this.time - this.serverBaseTime) * 1000;
  }

  elevatorOpenness(index: number): number {
    return this.elevators[index]?.openness ?? 0;
  }

  setOptions(options: Partial<SimOptions>): void {
    this.options = { ...this.options, ...options };
    this.bubbleManager.configure(this.options.bubbles, this.options.liveliness);
    this.party?.configure(this.options);
  }

  /** Area id containing a tile position, or null outside the building. */
  areaAt(x: number, y: number): string | null {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const { width, height } = this.building.grid;
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) return null;
    const index = this.areaIndex[ty * width + tx];
    return index > 0 ? this.areaIds[index - 1] : null;
  }

  setSnapshot(snapshot: OfficeSnapshot, serverNow: number): void {
    this.serverBase = serverNow;
    this.serverBaseTime = this.time;
    const waiting = waitingHires(snapshot.hires);
    // After a reset the rooms come back as they were most of the time: then the building is already right.
    if (
      this.rooms.sync(withHireProjects(snapshot.projects, waiting)) &&
      layoutKey(this.rooms.specs()) !== this.builtKey
    ) {
      this.relayout();
      for (const move of this.rooms.takeMoves()) this.onRoomMoved(move);
    }
    const instant = this.firstSnapshot;
    this.firstSnapshot = false;
    this.handOverHires(snapshot);
    const present = new Set<string>();
    this.parentsWithWork = new Set(
      snapshot.agents
        .filter((a) => a.kind === 'sub' && a.status === 'working' && a.parentId)
        .map((a) => a.parentId as string),
    );
    for (const agent of snapshot.agents) {
      present.add(agent.id);
      const existing = this.actors.get(agent.id);
      if (existing) this.updateAgent(existing, agent);
      else if (agent.status !== 'done' && agent.status !== 'offline') this.spawn(agent, instant);
    }
    for (const hire of waiting) {
      const placeholder = placeholderAgent(hire);
      present.add(placeholder.id);
      const existing = this.actors.get(placeholder.id);
      if (existing) existing.agent = placeholder;
      else this.spawn(placeholder, instant, hire.deskIndex);
    }
    for (const actor of this.list) {
      if (!present.has(actor.id) && !actor.leaving) {
        this.updateAgent(actor, { ...actor.agent, status: 'offline' });
      }
    }
    this.party.observe(snapshot);
  }

  /** Forgets everybody and every room; the next snapshot is placed at once (see `WorldApi.resetScene`). */
  reset(): void {
    for (const actor of this.list) {
      this.spots.releaseAll(actor.id);
      this.bubbleManager.withdraw(actor.id);
    }
    this.actors = new Map();
    this.list = [];
    this.bubbleList = [];
    this.rooms.reset();
    this.party.reset();
    this.firstSnapshot = true;
  }

  /** A pending hire whose session appeared: the placeholder person becomes that agent, right where it sits. */
  private handOverHires(snapshot: OfficeSnapshot): void {
    for (const hire of snapshot.hires ?? []) {
      if (hire.agentId === undefined) continue;
      const placeholder = this.actors.get(hireAgentId(hire.id));
      const agent = snapshot.agents.find((candidate) => candidate.id === hire.agentId);
      if (placeholder === undefined || agent === undefined || this.actors.has(agent.id)) continue;
      this.actors.delete(placeholder.id);
      this.spots.rekey(placeholder.id, agent.id);
      this.bubbleManager.withdraw(placeholder.id);
      placeholder.adopt(agent);
      placeholder.celebrateUntil = this.time + 1.8;
      this.actors.set(agent.id, placeholder);
      this.offerBubble(placeholder, {
        text: 'Cheguei!',
        msg: { key: 'bubble.arrived' },
        icon: '👋',
        importance: 60,
        sticky: false,
        ttl: 3.2,
      });
    }
  }

  /** Advance by wall-clock seconds, running fixed 30 Hz ticks. */
  advance(dtSeconds: number): void {
    this.accumulator += Math.min(dtSeconds, 1);
    let steps = 0;
    while (this.accumulator >= TICK && steps < MAX_STEPS_PER_ADVANCE) {
      this.tick(TICK);
      this.accumulator -= TICK;
      steps++;
    }
    if (steps === MAX_STEPS_PER_ADVANCE) this.accumulator = 0;
  }

  /** Run exactly `seconds` of simulation (tests, fast-forward). */
  runFor(seconds: number): void {
    const n = Math.round(seconds / TICK);
    for (let i = 0; i < n; i++) this.tick(TICK);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // layout

  private relayout(): void {
    this.building = computeBuilding(this.rooms.specs());
    this.builtKey = layoutKey(this.rooms.specs());
    this.layoutVersion++;
    this.spots.rebuild(this.building);
    this.elevators = this.building.elevators.map((_, i) => this.elevators[i] ?? { hold: 0, openness: 0, nextFree: 0 });
    this.buildAreaIndex();
    for (const actor of this.list) this.onLayoutChanged(actor);
  }

  private buildAreaIndex(): void {
    const { width, height } = this.building.grid;
    this.areaIndex = new Int16Array(width * height);
    const areas: AreaLayout[] = [...this.building.areas, this.building.corridor];
    this.areaIds = areas.map((a) => a.id);
    areas.forEach((area, i) => {
      const r = area.rect;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) this.areaIndex[y * width + x] = i + 1;
      }
    });
  }

  private onLayoutChanged(actor: Actor): void {
    if (actor.encounter) this.runner.cancel(actor);
    if (actor.home) actor.home = this.spots.get(actor.home.id) ?? null;
    if (actor.activity && actor.activity.steps.some((s) => !this.spots.get(s.spot.id))) this.activities.cancel(actor);
    if (actor.leaving || actor.phase === 'arriving' || actor.phase === 'exiting') return;
    if (actor.phase === 'toExit') this.walkToExit(actor);
    else if (actor.phase === 'toHome' || actor.phase === 'waitRoom' || !actor.home) this.goHome(actor);
    else if (actor.phase === 'toActivity' && actor.activity) this.activities.walkToStep(actor);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // agents

  private spawn(agent: Agent, instant: boolean, desk?: number): void {
    const actor = new Actor(agent, this.seed);
    actor.preferredDesk = desk;
    this.actors.set(agent.id, actor);
    this.list.push(actor);
    actor.idleDue = this.time + actor.rng.range(instant ? 4 : 12, instant ? 40 : 30);
    actor.home = this.assignHome(actor);
    if (instant && actor.home) {
      actor.phase = 'atHome';
      actor.x = actor.home.x;
      actor.y = actor.home.y;
      actor.dir = actor.home.dir;
      actor.leaveTile = actor.home.approach;
      actor.prevStatus = agent.status;
      return;
    }
    const elevator = this.elevators.length ? actor.rng.int(this.elevators.length) : 0;
    const door = this.building.elevators[elevator];
    const slot = actor.rng.int(door.rect.w);
    actor.elevator = elevator;
    actor.x = door.rect.x + slot + 0.5;
    actor.y = door.rect.y + 0.5;
    actor.dir = 's';
    actor.alpha = 0;
    actor.leaveTile = door.front[slot];
    actor.phase = 'arriving';
    actor.arriveAt = Math.max(this.time + 0.3, this.elevators[elevator].nextFree);
    this.elevators[elevator].nextFree = actor.arriveAt + 1.5;
    actor.exitT = 0;
  }

  private updateAgent(actor: Actor, agent: Agent): void {
    const previous = actor.agent;
    actor.agent = agent;
    const finishedTurn = previous.status === 'working' && agent.status === 'idle';
    if (finishedTurn && actor.phase === 'atHome') {
      actor.celebrateUntil = this.time + 2;
      this.offerBubble(actor, {
        text: 'Terminei!',
        msg: { key: 'bubble.done' },
        icon: '✅',
        importance: 60,
        sticky: false,
        ttl: 3.2,
      });
    }
    if (agent.status === 'waiting' && previous.status !== 'waiting') {
      this.offerBubble(actor, {
        text: 'Precisa de você',
        msg: { key: 'bubble.needsYou' },
        icon: '!',
        importance: ALERT_IMPORTANCE,
        sticky: true,
        ttl: 0,
      });
    }
    if (agent.status !== 'waiting' && previous.status === 'waiting') this.bubbleManager.withdrawSticky(actor.id);
    if (agent.status === 'idle' && previous.status !== 'idle') {
      actor.idleDue = this.time + actor.rng.range(10, 28);
    }
    if (agent.activity && agent.activity.id !== previous.activity?.id && agent.status === 'working') {
      this.offerBubble(actor, {
        text: clipText(agent.activity.text),
        msg: agent.activity.msg,
        icon: agent.activity.icon,
        importance: activityImportance(agent.activity),
        sticky: false,
        ttl: 4.6,
      });
    }
    if ((agent.status === 'done' || agent.status === 'offline') && !actor.leaving)
      this.beginLeave(actor, agent.status === 'done');
  }

  private offerBubble(actor: Actor, b: BubbleSpec): void {
    this.bubbleManager.offer({ agentId: actor.id, roomId: actor.areaId ?? 'corridor', ...b }, this.time);
  }

  private roomReady(areaId: string): boolean {
    const room = this.rooms.byArea(areaId);
    return !room || (room.phase !== 'dismantling' && room.progress >= ROOM_READY);
  }

  private assignHome(a: Actor): Spot | null {
    const claim = (s: Spot | undefined): Spot | null => (s && this.spots.claim(s.id, a.id) ? s : null);
    const room = this.rooms.live(a.projectId);
    if (a.kind === 'main') {
      if (room) {
        const desks = this.spots
          .free('desk', room.areaId, a.id)
          .sort((p, q) => (p.deskIndex ?? 0) - (q.deskIndex ?? 0));
        const wanted = desks.find((desk) => desk.deskIndex === a.preferredDesk);
        const spot = claim(wanted ?? desks[0]) ?? claim(this.spots.free('overflow', room.areaId, a.id)[0]);
        if (spot) return spot;
      }
    } else {
      const seats = this.spots.free('meeting', 'meeting', a.id);
      const seat = seats.length ? seats[hash32(a.seed, seats.length) % seats.length] : undefined;
      const spot = claim(seat);
      if (spot) return spot;
      if (room) {
        const desks = this.spots
          .free('desk', room.areaId, a.id)
          .sort((p, q) => (q.deskIndex ?? 0) - (p.deskIndex ?? 0));
        const fallback = claim(desks[0]) ?? claim(this.spots.free('overflow', room.areaId, a.id)[0]);
        if (fallback) return fallback;
      }
    }
    return claim(this.spots.free('wait', 'reception', a.id)[0]) ?? claim(this.spots.free('talk', 'corridor', a.id)[0]);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // tick

  private tick(dt: number): void {
    this.time += dt;
    this.tickCount++;
    for (const actor of this.list) this.updateActor(actor, dt);
    if (this.list.some((a) => a.remove)) {
      for (const a of this.list) {
        if (!a.remove) continue;
        this.spots.releaseAll(a.id);
        this.bubbleManager.withdraw(a.id);
        this.actors.delete(a.id);
      }
      this.list = this.list.filter((a) => !a.remove);
    }
    for (const e of this.elevators) {
      e.hold = Math.max(0, e.hold - dt);
      e.openness = clamp(e.openness + (e.hold > 0 ? 3 : -3) * dt, 0, 1);
    }
    const occupied = (areaId: string): boolean => this.list.some((a) => a.areaId === areaId);
    const update = this.rooms.advance(dt, occupied);
    if (update.layoutChanged) {
      this.relayout();
      for (const move of update.moves) this.onRoomMoved(move);
    }
    if (this.tickCount % 15 === 0) this.planSocial();
    if (this.tickCount % 3 === 0) {
      this.bubbleList = this.bubbleManager.update(this.time, (id) => {
        const a = this.actors.get(id);
        return a && a.alpha > 0.4 ? (a.areaId ?? 'corridor') : null;
      });
    }
  }

  private onRoomMoved(move: RoomMove): void {
    for (const actor of this.list) {
      if (actor.projectId !== move.projectId || actor.leaving || !actor.home) continue;
      if (actor.phase !== 'atHome') continue;
      if (move.instant) this.seatAtHome(actor);
      else this.goHome(actor);
    }
  }

  /** The room moved while the person sat in it: they are at their desk in the new place, no walk across the building. */
  private seatAtHome(a: Actor): void {
    const home = a.home ? this.spots.get(a.home.id) : undefined;
    if (!home) return this.goHome(a);
    a.home = home;
    a.x = home.x;
    a.y = home.y;
    a.dir = home.dir;
    a.leaveTile = home.approach;
    a.path = [];
    a.pathIndex = 0;
    a.moving = false;
  }

  private walkSpeed(): number {
    return SPEED[this.options.liveliness];
  }

  private updateActor(a: Actor, dt: number): void {
    a.poseT += dt;
    if (a.phase !== 'arriving') a.areaId = this.areaAt(a.x, a.y);
    a.celebrating = this.time < a.partyUntil && !this.options.reducedMotion;
    a.celebrationBadge = this.options.reducedMotion && this.time < a.badgeUntil;
    if (a.phase !== 'atHome') a.mood = 'idle';
    if (a.encounter && this.runner.update(a)) return;
    switch (a.phase) {
      case 'arriving':
        return this.tickArriving(a, dt);
      case 'toHome':
      case 'waitRoom':
      case 'toActivity':
      case 'toMeet':
      case 'toExit':
        return this.tickWalking(a, dt);
      case 'meeting':
        return;
      case 'atHome':
        return this.tickAtHome(a, dt);
      case 'doing':
        return this.activities.tick(a, dt);
      case 'exiting':
        return this.tickExiting(a, dt);
    }
  }

  private openElevator(index: number, hold = 1.8): void {
    const e = this.elevators[index];
    if (e) e.hold = Math.max(e.hold, hold);
  }

  private tickArriving(a: Actor, dt: number): void {
    if (this.time < a.arriveAt) {
      a.alpha = 0;
      return;
    }
    if (a.exitT === 0) this.openElevator(a.elevator, 2.2);
    a.exitT += dt;
    a.alpha = clamp((a.exitT - 0.5) / 0.35, 0, 1);
    a.areaId = this.areaAt(a.x, a.y + 1);
    if (a.exitT > 0.85) {
      a.alpha = 1;
      this.goHome(a);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // walking

  private startWalk(a: Actor, target: TilePos): boolean {
    const grid = this.building.grid;
    let start = a.tile();
    const prefix: Vec[] = [];
    if (!isWalkable(grid, start.x, start.y)) {
      const leave =
        a.leaveTile && isWalkable(grid, a.leaveTile.x, a.leaveTile.y) ? a.leaveTile : nearestWalkable(grid, start, 8);
      if (!leave) return false;
      start = leave;
      prefix.push(centerOf(leave));
    }
    const tiles = findPath(grid, start, target);
    if (!tiles) return false;
    const from = prefix.length ? prefix[0] : { x: a.x, y: a.y };
    a.path = [...prefix, ...smoothPath(grid, tiles, from)];
    a.pathIndex = 0;
    a.pathTarget = target;
    a.moving = true;
    a.seat = null;
    a.alert = false;
    a.setPose('walk');
    return true;
  }

  private teleport(a: Actor, target: TilePos): void {
    a.x = target.x + 0.5;
    a.y = target.y + 0.5;
    a.path = [];
    a.pathIndex = 0;
  }

  private tickWalking(a: Actor, dt: number): void {
    if (a.leaving && a.phase !== 'toExit' && a.phase !== 'exiting') return;
    if (a.phase === 'waitRoom') {
      if (a.pathIndex < a.path.length) {
        if (!this.stepPath(a, dt)) return;
      }
      a.moving = false;
      a.setPose('stand');
      a.dir = 's';
      a.waitCheck += dt;
      if (a.waitCheck > 0.6) {
        a.waitCheck = 0;
        this.goHome(a);
      }
      return;
    }
    if (this.time < a.pauseUntil) {
      a.moving = false;
      a.setPose(a.pausePose);
      return;
    }
    if (a.pauseUntil > 0) {
      a.pauseUntil = 0;
      a.moving = true;
      a.setPose('walk');
    }
    if (!this.stepPath(a, dt)) return;
    a.moving = false;
    a.setPose('stand');
    if (a.phase === 'toHome') {
      a.phase = 'atHome';
      a.leaveTile = a.home?.approach ?? a.tile();
      if (a.kind === 'sub' && a.home?.kind === 'meeting') this.party.director.noteArrival(a.id, this.time);
    } else if (a.phase === 'toMeet') this.runner.arrived(a);
    else if (a.phase === 'toActivity') this.activities.arriveAtStep(a);
    else if (a.phase === 'toExit') {
      a.phase = 'exiting';
      a.exitT = 0;
      this.openElevator(a.elevator, 2.4);
    }
  }

  /** Returns true when the path is finished. */
  private stepPath(a: Actor, dt: number): boolean {
    const speed = this.walkSpeed();
    while (a.pathIndex < a.path.length) {
      const p = a.path[a.pathIndex];
      a.dir = dirFromVector(p.x - a.x, p.y - a.y, a.dir);
      const arrived = approach(a, p.x, p.y, speed, dt);
      a.walkPhase += dt * speed * 0.62;
      if (!arrived) return false;
      a.pathIndex++;
      return a.pathIndex >= a.path.length;
    }
    return true;
  }

  private goHome(a: Actor): void {
    if (!a.home || !this.spots.get(a.home.id)) a.home = this.assignHome(a);
    const home = a.home;
    if (!home) {
      a.phase = 'waitRoom';
      a.path = [];
      a.pathIndex = 0;
      a.moving = false;
      a.setPose('stand');
      return;
    }
    if (!this.roomReady(home.areaId)) {
      const area = this.building.areas.find((x) => x.id === home.areaId);
      const door = area?.doors[0];
      if (door && this.startWalk(a, door.outside)) {
        a.phase = 'waitRoom';
        return;
      }
    }
    a.phase = 'toHome';
    if (!this.startWalk(a, home.approach)) {
      this.teleport(a, home.approach);
      a.phase = 'atHome';
      a.moving = false;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // at home (desk / seat)

  private tickAtHome(a: Actor, dt: number): void {
    if (a.leaving) return this.tickLeavingAtHome(a, dt);
    const home = a.home;
    if (!home || !this.spots.get(home.id)) return this.goHome(a);

    const status = a.agent.status;
    const celebrating = this.time < a.celebrateUntil || a.celebrating;
    const meeting = a.encounter?.endsAt != null;
    const reacting = this.time < a.reactUntil && status === 'idle';
    const stretching = this.time < a.microUntil && status === 'idle';
    const standing = status === 'waiting' || celebrating || meeting || reacting || !home.seat;
    const tx = home.x;
    const ty = home.y + (home.seat && standing ? 0.34 : 0);
    if (Math.hypot(a.x - home.x, a.y - home.y) > 2.5) return this.goHome(a);
    a.moving = approach(a, tx, ty, 2.4, dt) ? false : true;
    const face = meeting ? a.encounter?.face : reacting ? a.reactFace : celebrating ? 's' : undefined;
    a.dir = a.moving ? dirFromVector(tx - a.x, ty - a.y, a.dir) : (face ?? home.dir);
    a.seat = home.seat && !standing ? home.kind : null;
    a.alert = status === 'waiting';
    a.shellStage = 0;
    a.carrying = null;
    a.mood = workMood(a.agent, {
      now: this.serverNow(),
      foregroundShell: hasForegroundShell(a.agent),
      workingSubagents: this.parentsWithWork.has(a.id),
    });
    if (a.moving) {
      a.setPose(standing ? 'stand' : 'sit');
      return;
    }
    if (meeting) return;
    if (status === 'waiting') a.setPose('hand');
    else if (celebrating) a.setPose('celebrate');
    else if (reacting) a.setPose('clap');
    else if (status === 'working') this.workPose(a, home);
    else if (stretching) a.setPose('stretch');
    else {
      a.setPose(home.seat ? 'sit' : 'stand');
      if (!a.hiring && home.seat && !this.options.reducedMotion) scheduleStretch(a, this.time, this.options.liveliness);
    }

    if (
      status === 'idle' &&
      !a.hiring &&
      !a.encounter &&
      !this.options.reducedMotion &&
      !celebrating &&
      !reacting &&
      !stretching &&
      this.time >= a.idleDue
    )
      this.activities.tryWander(a);
    if ((home.kind === 'wait' || home.kind === 'overflow' || home.kind === 'talk') && (a.stageTimer += dt) > 2) {
      a.stageTimer = 0;
      const better = this.assignBetterHome(a);
      if (better) this.goHome(a);
    }
  }

  /** The pose of a working person: shell stages first, then the pose of what the agent is busy with. */
  private workPose(a: Actor, home: Spot): void {
    a.shellStage = shellStage(a.agent, this.serverNow());
    if (!home.seat) return a.setPose('stand');
    if (hasForegroundShell(a.agent)) return a.setPose(SHELL_STAGE_POSES[a.shellStage] ?? 'lean');
    a.setPose(seatedPoseFor(a.mood, a.agent.activity?.kind));
  }

  /** Once a second: orders new encounters, waves in the corridor and farewells. */
  private planSocial(): void {
    if (this.options.reducedMotion || this.list.length < 2) return;
    const views = this.party.views();
    for (const order of this.party.director.plan(views, this.time)) this.runner.start(order);
    for (const pair of this.party.director.waves(views, this.time)) this.waveAt(pair.a, pair.b);
  }

  private waveAt(idA: string, idB: string): void {
    const a = this.actors.get(idA);
    const b = this.actors.get(idB);
    if (a && b) startWave(a, b, this.time);
  }

  private assignBetterHome(a: Actor): boolean {
    const previous = a.home;
    if (!previous) return false;
    this.spots.release(previous.id, a.id);
    const next = this.assignHome(a);
    if (next && (next.kind === 'desk' || next.kind === 'meeting')) {
      a.home = next;
      return true;
    }
    if (next) this.spots.release(next.id, a.id);
    this.spots.claim(previous.id, a.id);
    return false;
  }

  private tickLeavingAtHome(a: Actor, dt: number): void {
    const home = a.home;
    const hosting = a.encounter !== null;
    if (home && (hosting || this.time < a.celebrateUntil)) {
      approach(a, home.x, home.y + (home.seat ? 0.34 : 0), 2.4, dt);
      if (!hosting) a.setPose('celebrate');
      else if (a.encounter?.endsAt === null) a.setPose('stand');
      a.seat = null;
    }
    if (a.holdLeaveUntil > 0 && !hosting) {
      a.holdLeaveUntil = 0;
      a.leaveAt = Math.min(a.leaveAt, this.time + 0.5);
    }
    if (hosting || this.time < a.leaveAt) return;
    this.walkToExit(a);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // leaving

  private beginLeave(a: Actor, celebrate: boolean): void {
    if (a.encounter) this.runner.cancel(a);
    a.leaving = true;
    a.celebrateUntil = celebrate && a.phase === 'atHome' ? this.time + 1.8 : 0;
    a.leaveAt = this.time + a.rng.range(0.4, 2.2) + (a.celebrateUntil > 0 ? 1.8 : 0);
    this.bubbleManager.withdrawSticky(a.id);
    if (a.phase === 'doing' || a.phase === 'toActivity') {
      this.activities.cancel(a);
      a.leaveAt = this.time + 0.2;
    }
    if (a.phase === 'arriving' || a.phase === 'waitRoom' || a.phase === 'toHome') a.leaveAt = this.time + 0.2;
    if (a.phase === 'arriving' && this.time < a.arriveAt) a.remove = true;
    if (a.phase !== 'atHome') this.walkToExit(a);
    else if (celebrate && a.kind === 'sub' && !this.options.reducedMotion) this.tryFarewell(a);
  }

  /** A subagent that finished well says goodbye to its main agent with a handshake, if the main agent can come. */
  private tryFarewell(a: Actor): void {
    a.holdLeaveUntil = this.time + FAREWELL_PATIENCE;
    const order = this.party.director.farewell(this.party.views(), a.id, this.time);
    if (order && this.runner.start(order)) a.leaveAt = Math.max(a.leaveAt, this.time + FAREWELL_PATIENCE);
    else a.holdLeaveUntil = 0;
  }

  private walkToExit(a: Actor): void {
    if (a.encounter) this.runner.cancel(a);
    this.spots.releaseAll(a.id);
    a.activity = null;
    a.home = null;
    a.carrying = null;
    a.alert = false;
    const elevators = this.building.elevators;
    let best = 0;
    let bestDist = Infinity;
    elevators.forEach((e, i) => {
      const d = Math.hypot(a.x - e.front[0].x, a.y - e.front[0].y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    a.elevator = best;
    const front = elevators[best].front;
    const target = front[a.rng.int(front.length)];
    a.phase = 'toExit';
    a.alpha = 1;
    if (!this.startWalk(a, target)) {
      this.teleport(a, target);
      a.phase = 'exiting';
      a.exitT = 0;
    }
  }

  private tickExiting(a: Actor, dt: number): void {
    const door = this.building.elevators[a.elevator];
    this.openElevator(a.elevator, 1.2);
    a.exitT += dt;
    a.moving = a.exitT > 0.4;
    if (!a.moving) {
      a.setPose('stand');
      a.dir = 'n';
      return;
    }
    a.dir = 'n';
    a.setPose('walk');
    a.walkPhase += dt * 1.2;
    const tx = Math.floor(a.x) + 0.5;
    const arrived = approach(a, tx, door.rect.y + 0.5, 1.3, dt);
    a.alpha = clamp((a.y - (door.rect.y + 0.5)) / 0.9, 0, 1);
    if (arrived) a.remove = true;
  }

  /** Rooms (including those animating) for renderers. */
  get roomStates(): readonly RoomState[] {
    return this.rooms.all;
  }
}
