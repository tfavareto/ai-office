import type { Agent, Msg, OfficeSnapshot } from '@ai-office/shared';
import { computeBuilding } from '../layout/building';
import { isWalkable, nearestWalkable } from '../layout/grid';
import { clamp, hash32 } from '../layout/rng';
import type { AreaLayout, BuildingLayout, Spot, TilePos } from '../layout/types';
import { Actor, approach, dirFromVector, type ActivityPlan } from './actor';
import { type DeskTarget, emptyDeskAt } from './desks';
import { hireAgentId, placeholderAgent, waitingHires, withHireProjects } from './hires';
import { activityImportance, BubbleManager, clipText, ALERT_IMPORTANCE, type Bubble } from './bubbles';
import { findPath, smoothPath, type Vec } from './path';
import { RoomManager, type RoomMove, type RoomState } from './rooms';
import { SpotBook } from './spots';
import { DEFAULT_SIM_OPTIONS, TICK, type Character, type SimOptions } from './types';
import { planWander, restDuration, type WanderResult } from './wander';

const SPEED: Record<SimOptions['liveliness'], number> = { calm: 1.6, normal: 2.0, lively: 2.5 };
const ROOM_READY = 0.7;
const MAX_STEPS_PER_ADVANCE = 12;
/** Shell wait stages: lean back, stretch (1 min), popcorn (3 min), nap (8 min). */
const SHELL_STAGE_SECONDS = [0, 60, 180, 480];

interface ElevatorState {
  hold: number;
  openness: number;
  nextFree: number;
}

export interface SimStats {
  actors: number;
  walking: number;
}

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

  constructor(seed = 1) {
    this.seed = seed;
    this.building = computeBuilding([]);
    this.relayout();
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
    if (this.rooms.sync(withHireProjects(snapshot.projects, waiting))) this.relayout();
    const instant = this.firstSnapshot;
    this.firstSnapshot = false;
    this.handOverHires(snapshot);
    const present = new Set<string>();
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
      this.offerBubble(placeholder, { text: 'Cheguei!', msg: { key: 'bubble.arrived' }, icon: '👋', importance: 60, sticky: false, ttl: 3.2 });
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
    if (actor.home) actor.home = this.spots.get(actor.home.id) ?? null;
    if (actor.activity && actor.activity.steps.some((s) => !this.spots.get(s.spot.id))) this.cancelActivity(actor);
    if (actor.leaving || actor.phase === 'arriving' || actor.phase === 'exiting') return;
    if (actor.phase === 'toExit') this.walkToExit(actor);
    else if (actor.phase === 'toHome' || actor.phase === 'waitRoom' || !actor.home) this.goHome(actor);
    else if (actor.phase === 'toActivity' && actor.activity) this.walkToStep(actor);
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
      this.offerBubble(actor, { text: 'Terminei!', msg: { key: 'bubble.done' }, icon: '✅', importance: 60, sticky: false, ttl: 3.2 });
    }
    if (agent.status === 'waiting' && previous.status !== 'waiting') {
      this.offerBubble(actor, { text: 'Precisa de você', msg: { key: 'bubble.needsYou' }, icon: '!', importance: ALERT_IMPORTANCE, sticky: true, ttl: 0 });
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
    if ((agent.status === 'done' || agent.status === 'offline') && !actor.leaving) this.beginLeave(actor, agent.status === 'done');
  }

  private offerBubble(actor: Actor, b: { text: string; msg?: Msg; icon: string; importance: number; sticky: boolean; ttl: number }): void {
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
        const desks = this.spots.free('desk', room.areaId, a.id).sort((p, q) => (p.deskIndex ?? 0) - (q.deskIndex ?? 0));
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
        const desks = this.spots.free('desk', room.areaId, a.id).sort((p, q) => (q.deskIndex ?? 0) - (p.deskIndex ?? 0));
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
      if (actor.phase === 'atHome') this.goHome(actor);
    }
  }

  private walkSpeed(): number {
    return SPEED[this.options.liveliness];
  }

  private updateActor(a: Actor, dt: number): void {
    a.poseT += dt;
    if (a.phase !== 'arriving') a.areaId = this.areaAt(a.x, a.y);
    switch (a.phase) {
      case 'arriving':
        return this.tickArriving(a, dt);
      case 'toHome':
      case 'waitRoom':
      case 'toActivity':
      case 'toExit':
        return this.tickWalking(a, dt);
      case 'atHome':
        return this.tickAtHome(a, dt);
      case 'doing':
        return this.tickDoing(a, dt);
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
      const leave = a.leaveTile && isWalkable(grid, a.leaveTile.x, a.leaveTile.y) ? a.leaveTile : nearestWalkable(grid, start, 8);
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
    if (!this.stepPath(a, dt)) return;
    a.moving = false;
    a.setPose('stand');
    if (a.phase === 'toHome') {
      a.phase = 'atHome';
      a.leaveTile = a.home?.approach ?? a.tile();
    } else if (a.phase === 'toActivity') this.arriveAtStep(a);
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
    const celebrating = this.time < a.celebrateUntil;
    const standing = status === 'waiting' || celebrating || !home.seat;
    const tx = home.x;
    const ty = home.y + (home.seat && standing ? 0.34 : 0);
    if (Math.hypot(a.x - home.x, a.y - home.y) > 2.5) return this.goHome(a);
    a.moving = approach(a, tx, ty, 2.4, dt) ? false : true;
    a.dir = a.moving ? dirFromVector(tx - a.x, ty - a.y, a.dir) : home.dir;
    a.seat = home.seat && !standing ? home.kind : null;
    a.alert = status === 'waiting';
    a.shellStage = 0;
    a.carrying = null;
    if (a.moving) {
      a.setPose(standing ? 'stand' : 'sit');
      return;
    }
    if (status === 'waiting') a.setPose('hand');
    else if (celebrating) a.setPose('celebrate');
    else if (status === 'working') {
      a.shellStage = this.shellStage(a.agent);
      const stagePose = ['lean', 'stretch', 'popcorn', 'sleep'] as const;
      if (a.shellStage >= 0 && this.hasForegroundShell(a.agent) && home.seat) a.setPose(stagePose[a.shellStage]);
      else a.setPose(home.seat ? 'type' : 'stand');
    } else a.setPose(home.seat ? 'sit' : 'stand');

    if (status === 'idle' && !a.hiring && !this.options.reducedMotion && !celebrating && this.time >= a.idleDue) this.tryWander(a);
    if ((home.kind === 'wait' || home.kind === 'overflow' || home.kind === 'talk') && (a.stageTimer += dt) > 2) {
      a.stageTimer = 0;
      const better = this.assignBetterHome(a);
      if (better) this.goHome(a);
    }
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

  private hasForegroundShell(agent: Agent): boolean {
    return agent.shells.some((s) => !s.background && s.kind === 'shell');
  }

  private shellStage(agent: Agent): number {
    const started = agent.shells.filter((s) => !s.background && s.kind === 'shell').map((s) => s.startedAt);
    if (started.length === 0) return 0;
    const elapsed = (this.serverNow() - Math.min(...started)) / 1000;
    let stage = 0;
    SHELL_STAGE_SECONDS.forEach((threshold, i) => {
      if (elapsed >= threshold) stage = i;
    });
    return stage;
  }

  private tickLeavingAtHome(a: Actor, dt: number): void {
    const home = a.home;
    if (home && this.time < a.celebrateUntil) {
      approach(a, home.x, home.y + (home.seat ? 0.34 : 0), 2.4, dt);
      a.setPose('celebrate');
      a.seat = null;
    }
    if (this.time < a.leaveAt) return;
    this.walkToExit(a);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // activities

  private tryWander(a: Actor): void {
    const result = planWander(a, { spots: this.spots, actors: this.list, now: this.time }, a.rng);
    if (!result) {
      a.idleDue = this.time + 6 + a.rng.range(0, 6);
      return;
    }
    this.beginPlan(a, result);
  }

  private beginPlan(a: Actor, result: WanderResult): void {
    const claimAll = (actor: Actor, plan: ActivityPlan): boolean => {
      const first = plan.steps[0].spot;
      return this.spots.claim(first.id, actor.id);
    };
    if (!claimAll(a, result.plan)) return;
    if (result.partner && !claimAll(result.partner.actor, result.partner.plan)) {
      this.spots.release(result.plan.steps[0].spot.id, a.id);
      return;
    }
    this.startPlan(a, result.plan);
    if (result.partner) this.startPlan(result.partner.actor, result.partner.plan);
  }

  private startPlan(a: Actor, plan: ActivityPlan): void {
    a.activity = plan;
    a.phase = 'toActivity';
    a.leaveTile = a.home?.approach ?? a.leaveTile;
    this.walkToStep(a);
  }

  private walkToStep(a: Actor): void {
    const step = a.activity?.steps[a.activity.index];
    if (!step) return this.goHome(a);
    if (!this.startWalk(a, step.spot.approach)) {
      this.cancelActivity(a);
      this.goHome(a);
    }
  }

  private arriveAtStep(a: Actor): void {
    const plan = a.activity;
    const step = plan?.steps[plan.index];
    if (!plan || !step) return this.goHome(a);
    a.phase = 'doing';
    a.moving = false;
    plan.ready = false;
    plan.endsAt = null;
    a.setPose('stand');
  }

  private tickDoing(a: Actor, dt: number): void {
    const plan = a.activity;
    const step = plan?.steps[plan.index];
    if (!plan || !step) return this.goHome(a);
    if (a.leaving) return this.walkToExit(a);
    const interrupted = a.agent.status !== 'idle' || this.options.reducedMotion;
    if (interrupted) {
      this.cancelActivity(a);
      return this.goHome(a);
    }
    const spot = step.spot;
    if (!plan.ready) {
      if (approach(a, spot.x, spot.y, 2.4, dt)) {
        plan.ready = true;
        a.dir = spot.dir;
        a.seat = spot.seat ? spot.kind : null;
        a.carrying = step.carry ?? null;
        a.leaveTile = spot.approach;
        a.setPose(step.pose);
      } else {
        a.dir = dirFromVector(spot.x - a.x, spot.y - a.y, a.dir);
        return;
      }
    }
    const partner = plan.partnerId ? this.actors.get(plan.partnerId) : undefined;
    if (plan.partnerId) {
      const theirs = partner?.activity;
      if (!partner || !theirs || partner.leaving || (partner.phase !== 'doing' && partner.phase !== 'toActivity')) {
        this.finishActivity(a);
        return;
      }
      if (plan.endsAt === null) {
        if (!(partner.phase === 'doing' && theirs.ready)) return;
        const endsAt = this.time + step.dur;
        plan.endsAt = endsAt;
        theirs.endsAt = endsAt;
      }
    } else if (plan.endsAt === null) plan.endsAt = this.time + step.dur;

    if (step.pose === 'talk' || step.pose === 'listen') {
      const turn = Math.floor((this.time + (step.pose === 'talk' ? 0 : 3.4)) / 3.4) % 2;
      a.setPose(turn === 0 ? 'talk' : 'listen');
    }
    if (plan.endsAt !== null && this.time >= plan.endsAt) this.nextStep(a);
  }

  private nextStep(a: Actor): void {
    const plan = a.activity;
    if (!plan) return;
    const nextIndex = plan.index + 1;
    const next = plan.steps[nextIndex];
    if (next && this.spots.claim(next.spot.id, a.id)) {
      this.spots.release(plan.steps[plan.index].spot.id, a.id);
      plan.index = nextIndex;
      a.phase = 'toActivity';
      this.walkToStep(a);
      return;
    }
    this.finishActivity(a);
  }

  private finishActivity(a: Actor): void {
    this.cancelActivity(a);
    a.idleDue = this.time + restDuration(a.rng, this.options.liveliness);
    this.goHome(a);
  }

  private cancelActivity(a: Actor): void {
    const plan = a.activity;
    if (!plan) return;
    for (const step of plan.steps) this.spots.release(step.spot.id, a.id);
    a.activity = null;
    a.carrying = null;
    a.seat = null;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // leaving

  private beginLeave(a: Actor, celebrate: boolean): void {
    a.leaving = true;
    a.celebrateUntil = celebrate && a.phase === 'atHome' ? this.time + 1.8 : 0;
    a.leaveAt = this.time + a.rng.range(0.4, 2.2) + (a.celebrateUntil > 0 ? 1.8 : 0);
    this.bubbleManager.withdrawSticky(a.id);
    if (a.phase === 'doing' || a.phase === 'toActivity') {
      this.cancelActivity(a);
      a.leaveAt = this.time + 0.2;
    }
    if (a.phase === 'arriving' || a.phase === 'waitRoom' || a.phase === 'toHome') a.leaveAt = this.time + 0.2;
    if (a.phase === 'arriving' && this.time < a.arriveAt) a.remove = true;
    if (a.phase !== 'atHome') this.walkToExit(a);
  }

  private walkToExit(a: Actor): void {
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
