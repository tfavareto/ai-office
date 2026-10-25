// Executes encounters ordered by the director: who walks where, when the greeting starts and ends, and what cancels
// it. Real work always wins: a person who starts waiting for the user, a partner who leaves or any layout change
// ends the encounter at once and sends everybody back to their place.
import type { Dir, TilePos } from '../layout/types';
import { type Actor, dirFromVector } from './actor';
import type { EncounterKind, EncounterOrder } from './encounters';
import type { Pose } from './types';

export interface EncounterState {
  id: number;
  kind: EncounterKind;
  partnerId: string;
  role: 'walker' | 'host';
  /** Both people walk to meet halfway. */
  bothWalk: boolean;
  startedAt: number;
  duration: number;
  /** Set when the greeting itself begins. */
  endsAt: number | null;
  /** The person has reached the meeting place (a host that does not walk always has). */
  arrived: boolean;
  face: Dir;
}

/** What the runner needs from the simulation. */
export interface RunnerHost {
  now(): number;
  actor(id: string): Actor | undefined;
  /** Walks to a tile in a given phase; false when there is no way. */
  walk(a: Actor, tile: TilePos): boolean;
  goHome(a: Actor): void;
  /** A walkable tile at or near a position (tile units). */
  meetingTiles(x: number, y: number): readonly [TilePos, TilePos] | null;
  bubble(a: Actor, icon: string, ttl: number): void;
  spark(x: number, y: number): void;
}

const MAX_SECONDS = 28;
const APPROACH_LIMIT = 22;

const POSES: Record<EncounterKind, readonly [Pose, Pose]> = {
  handshake: ['shake', 'shake'],
  highfive: ['highfive', 'highfive'],
  check: ['listen', 'talk'],
};
const ICONS: Record<EncounterKind, string> = { handshake: '🤝', highfive: '🙌', check: '👀' };

export class EncounterRunner {
  private counter = 0;

  constructor(private readonly host: RunnerHost) {}

  /** Starts an order; false when it cannot be done (no way there, somebody busy). */
  start(order: EncounterOrder): boolean {
    const walker = this.host.actor(order.walker);
    const other = this.host.actor(order.host);
    if (!walker || !other || walker.encounter || other.encounter) return false;
    const id = ++this.counter;
    const make = (partnerId: string, role: 'walker' | 'host', arrived: boolean): EncounterState => ({
      id,
      kind: order.kind,
      partnerId,
      role,
      bothWalk: order.bothWalk,
      startedAt: this.host.now(),
      duration: order.duration,
      endsAt: null,
      arrived,
      face: 's',
    });
    walker.encounter = make(other.id, 'walker', false);
    other.encounter = make(walker.id, 'host', !order.bothWalk);
    const ok = order.bothWalk ? this.sendBoth(walker, other) : this.sendWalker(walker, other);
    if (!ok) this.cancel(walker);
    return ok;
  }

  private sendWalker(walker: Actor, other: Actor): boolean {
    const tile = other.home?.approach ?? other.tile();
    if (Math.hypot(walker.x - tile.x, walker.y - tile.y) > 80) return false;
    walker.phase = 'toMeet';
    walker.leaveTile = walker.home?.approach ?? walker.leaveTile;
    return this.host.walk(walker, tile);
  }

  private sendBoth(a: Actor, b: Actor): boolean {
    const tiles = this.host.meetingTiles((a.x + b.x) / 2, (a.y + b.y) / 2);
    if (!tiles) return false;
    const [ta, tb] = tiles;
    for (const p of [a, b]) {
      p.phase = 'toMeet';
      p.leaveTile = p.home?.approach ?? p.leaveTile;
    }
    return this.host.walk(a, ta) && this.host.walk(b, tb);
  }

  /** A walker reached its meeting tile. */
  arrived(a: Actor): void {
    const e = a.encounter;
    if (!e) return this.host.goHome(a);
    a.phase = 'meeting';
    a.moving = false;
    e.arrived = true;
    a.setPose('stand');
    const partner = this.host.actor(e.partnerId);
    if (partner) e.face = dirFromVector(partner.x - a.x, partner.y - a.y, e.face);
    a.dir = e.face;
  }

  /** Called every tick for a person in an encounter. Returns true when the encounter ended or was cancelled. */
  update(a: Actor): boolean {
    const e = a.encounter;
    if (!e) return false;
    const partner = this.host.actor(e.partnerId);
    const now = this.host.now();
    if (!partner || !partner.encounter || partner.encounter.id !== e.id || this.broken(a, partner, now)) {
      this.cancel(a);
      return true;
    }
    if (e.endsAt === null) {
      if (e.arrived && partner.encounter.arrived) this.begin(a, partner, e);
      return false;
    }
    if (a.encounter) this.perform(a, e, now);
    if (now >= e.endsAt) {
      this.finish(a);
      return true;
    }
    return false;
  }

  private broken(a: Actor, partner: Actor, now: number): boolean {
    const e = a.encounter as EncounterState;
    if (now - e.startedAt > MAX_SECONDS) return true;
    for (const p of [a, partner]) {
      if (p.agent.status === 'waiting' || p.remove) return true;
      if (p.leaving && p.holdLeaveUntil <= now) return true;
    }
    return e.endsAt === null && now - e.startedAt > APPROACH_LIMIT;
  }

  /** Both are in place: the greeting starts for both at once. */
  private begin(a: Actor, partner: Actor, e: EncounterState): void {
    const end = this.host.now() + e.duration;
    e.endsAt = end;
    if (partner.encounter) partner.encounter.endsAt = end;
    e.face = dirFromVector(partner.x - a.x, partner.y - a.y, e.face);
    if (partner.encounter) partner.encounter.face = dirFromVector(a.x - partner.x, a.y - partner.y, e.face);
    if (e.role === 'walker') {
      this.host.bubble(a, ICONS[e.kind], e.duration);
      if (e.kind === 'highfive') this.host.spark((a.x + partner.x) / 2, (a.y + partner.y) / 2);
    }
  }

  private perform(a: Actor, e: EncounterState, now: number): void {
    const [walkerPose, hostPose] = POSES[e.kind];
    let pose = e.role === 'walker' ? walkerPose : hostPose;
    if (e.kind === 'check') {
      const turn = Math.floor((now - e.startedAt) / 2.5) % 2 === 0;
      const speaking = turn === (e.role === 'host');
      pose = speaking ? 'talk' : 'listen';
    }
    a.dir = e.face;
    a.setPose(pose);
  }

  private finish(a: Actor): void {
    const e = a.encounter;
    if (!e) return;
    const partner = this.host.actor(e.partnerId);
    this.release(a);
    if (partner && partner.encounter?.id === e.id) this.release(partner);
  }

  /** Ends the encounter of this person and its partner; everybody returns to their place. */
  cancel(a: Actor): void {
    const e = a.encounter;
    if (!e) return;
    const partner = this.host.actor(e.partnerId);
    this.release(a);
    if (partner && partner.encounter?.id === e.id) this.release(partner);
  }

  private release(a: Actor): void {
    a.encounter = null;
    if (a.phase === 'toMeet' || a.phase === 'meeting') {
      a.moving = false;
      this.host.goHome(a);
    }
  }
}
