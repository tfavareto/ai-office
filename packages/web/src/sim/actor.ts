import type { Agent, AgentKind, AgentStatus } from '@ai-office/shared';
import type { Dir, Spot, TilePos } from '../layout/types';
import { Rng } from '../layout/rng';
import { isHireAgentId } from './hires';
import type { Vec } from './path';
import type { EncounterState } from './runner';
import type { Character, Pose, SeatKind, WorkMood } from './types';

export type Phase =
  | 'arriving' // waiting for / stepping out of the elevator
  | 'toHome'
  | 'waitRoom' // room still being built: waiting in front of its door
  | 'atHome'
  | 'toActivity'
  | 'toMeet' // walking to an encounter (handshake, check-in, high five)
  | 'meeting' // arrived: performing the greeting
  | 'doing'
  | 'toExit'
  | 'exiting';

export interface ActivityStep {
  spot: Spot;
  pose: Pose;
  /** Seconds to stay (pair activities share the end time). */
  dur: number;
  carry?: 'cup';
}

export interface ActivityPlan {
  steps: ActivityStep[];
  index: number;
  /** Pair activity (chat / ping-pong): the other participant. */
  partnerId?: string;
  /** Sim time at which `doing` ends; null until the step starts (pairs: until both are ready). */
  endsAt: number | null;
  ready: boolean;
}

/** Mutable character used by the simulation; renderers see it through the readonly `Character` interface. */
export class Actor implements Character {
  id: string;
  agentId: string;
  readonly rng: Rng;
  agent: Agent;
  x = 0;
  y = 0;
  dir: Dir = 's';
  pose: Pose = 'stand';
  poseT = 0;
  walkPhase = 0;
  alpha = 1;
  seat: SeatKind = null;
  moving = false;
  areaId: string | null = null;
  shellStage = 0;
  carrying: 'cup' | null = null;
  alert = false;
  mood: WorkMood = 'idle';
  celebrating = false;
  celebrationBadge = false;
  /** A celebration (confetti) lasts until this time: the person jumps and cheers. */
  partyUntil = 0;
  /** Reduced motion: the still badge shows until this time. */
  badgeUntil = 0;

  phase: Phase = 'arriving';
  path: Vec[] = [];
  pathIndex = 0;
  pathTarget: TilePos | null = null;
  home: Spot | null = null;
  activity: ActivityPlan | null = null;
  /** Walkable tile to step to first when the current tile is a seat / elevator door. */
  leaveTile: TilePos | null = null;
  idleDue = 0;
  celebrateUntil = 0;
  arriveAt = 0;
  elevator = 0;
  stageTimer = 0;
  leaving = false;
  leaveAt = 0;
  exitT = 0;
  remove = false;
  prevStatus: AgentStatus;
  /** Time spent waiting for a room to be built (re-check throttle). */
  waitCheck = 0;
  /** The encounter this person is part of (greeting, check-in, high five), if any. */
  encounter: EncounterState | null = null;
  /** While walking, stop and hold `pausePose` until this time (a wave in the corridor). */
  pauseUntil = 0;
  pausePose: Pose = 'wave';
  /** Colleagues react to a celebration until this time (clapping, facing `reactFace`). */
  reactUntil = 0;
  reactFace: Dir = 's';
  /** Next idle stretch at the desk, and when the current one ends. */
  microDue = 0;
  microUntil = 0;
  /** A subagent about to leave waits for its farewell handshake until this time. */
  holdLeaveUntil = 0;
  /** Turn counter of a chat, so each new turn gets one bubble. */
  chatTurn = -1;
  /** Desk (index in the room) this person was asked to sit at: a hire placeholder, and the agent that takes it over. */
  preferredDesk: number | undefined;

  constructor(agent: Agent, seed: number) {
    this.id = agent.id;
    this.agentId = agent.id;
    this.agent = agent;
    this.rng = new Rng(seed ^ agent.seed);
    this.prevStatus = agent.status;
  }

  /** A placeholder for an agent being hired (not a real session yet). */
  get hiring(): boolean {
    return isHireAgentId(this.id);
  }
  get name(): string {
    return this.agent.name;
  }
  get kind(): AgentKind {
    return this.agent.kind;
  }
  get look(): 'f' | 'm' {
    return this.agent.look;
  }
  get seed(): number {
    return this.agent.seed;
  }
  get accountId(): string {
    return this.agent.accountId;
  }
  get projectId(): string {
    return this.agent.projectId;
  }
  get status(): AgentStatus {
    return this.agent.status;
  }

  /** The real agent takes this person over: same body, same desk, from now on it carries the agent's data. */
  adopt(agent: Agent): void {
    this.id = agent.id;
    this.agentId = agent.id;
    this.agent = agent;
  }

  setPose(pose: Pose): void {
    if (this.pose !== pose) {
      this.pose = pose;
      this.poseT = 0;
    }
  }

  tile(): TilePos {
    return { x: Math.floor(this.x), y: Math.floor(this.y) };
  }
}

export function dirFromVector(dx: number, dy: number, fallback: Dir): Dir {
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return fallback;
  if (Math.abs(dx) > Math.abs(dy) * 1.15) return dx > 0 ? 'e' : 'w';
  return dy > 0 ? 's' : 'n';
}

/** Moves toward a point at `speed` tiles/s; returns true when it got there. */
export function approach(actor: Actor, tx: number, ty: number, speed: number, dt: number): boolean {
  const dx = tx - actor.x;
  const dy = ty - actor.y;
  const dist = Math.hypot(dx, dy);
  const step = speed * dt;
  if (dist <= step) {
    actor.x = tx;
    actor.y = ty;
    return true;
  }
  actor.x += (dx / dist) * step;
  actor.y += (dy / dist) * step;
  return false;
}
