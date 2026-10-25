// Who meets whom: the pure part of the choreography between people (handshakes with subagents, check-ins, high fives
// and waves in the corridor). The director only decides; the simulation walks the people there. It sees nothing but
// the people it is handed and the times it is given, and rolls its dice from a seed, so it is deterministic.
import type { AgentKind, AgentStatus } from '@ai-office/shared';
import { Rng } from '../layout/rng';
import type { Liveliness } from './bubbles';
import type { Dir } from '../layout/types';

export type EncounterKind = 'handshake' | 'check' | 'highfive';

/** A read-only description of a person for the director. */
export interface PersonView {
  id: string;
  kind: AgentKind;
  parentId?: string;
  projectId: string;
  areaId: string | null;
  x: number;
  y: number;
  dir: Dir;
  status: AgentStatus;
  /** Sitting (or standing) at its home spot, with nothing else going on: free to be approached. */
  free: boolean;
  moving: boolean;
  leaving: boolean;
}

export interface EncounterOrder {
  kind: EncounterKind;
  /** The person who walks over. */
  walker: string;
  /** The person who waits (or, for a high five, the other one who walks to meet halfway). */
  host: string;
  /** Both walk and meet halfway. */
  bothWalk: boolean;
  /** Seconds of the greeting itself. */
  duration: number;
}

export interface WavePair {
  a: string;
  b: string;
}

/** Seconds between two encounters started anywhere, per animation level. */
const GLOBAL_GAP: Record<Liveliness, number> = { calm: 12, normal: 6, lively: 3 };
const CHECK_COOLDOWN: Record<Liveliness, number> = { calm: 180, normal: 90, lively: 45 };
const CHECK_CHANCE = 0.45;
const HIGHFIVE_WINDOW = 8;
const HIGHFIVE_MAX_DISTANCE = 16;
const HIGHFIVE_COOLDOWN = 30;
/** A greeting at the arrival of a subagent is only worth it for this long. */
const ARRIVAL_PATIENCE = 20;
const WAVE_DISTANCE = 1.7;
const WAVE_PAIR_COOLDOWN = 50;
const WAVE_GAP = 4;
const WAVE_CHANCE = 0.6;
export const HANDSHAKE_SECONDS = 2.4;
export const CHECK_SECONDS = 5;
export const HIGHFIVE_SECONDS = 1.4;
export const WAVE_SECONDS = 1.1;

interface Celebrated {
  agentId: string;
  projectId: string;
  at: number;
}

function distance(a: PersonView, b: PersonView): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const AVAILABLE: readonly AgentStatus[] = ['working', 'idle'];

function available(p: PersonView): boolean {
  return p.free && !p.leaving && AVAILABLE.includes(p.status);
}

export class EncounterDirector {
  private readonly rng: Rng;
  private liveliness: Liveliness = 'normal';
  private lastStart = -Infinity;
  private readonly lastChecked = new Map<string, number>();
  private readonly lastHighFive = new Map<string, number>();
  private readonly lastWave = new Map<string, number>();
  private lastWaveAt = -Infinity;
  private arrivals = new Map<string, number>();
  private celebrated: Celebrated[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed);
  }

  configure(liveliness: Liveliness): void {
    this.liveliness = liveliness;
  }

  reset(): void {
    this.lastStart = -Infinity;
    this.lastChecked.clear();
    this.lastHighFive.clear();
    this.lastWave.clear();
    this.lastWaveAt = -Infinity;
    this.arrivals.clear();
    this.celebrated = [];
  }

  /** A subagent sat down in the meeting room: its main agent may come over to greet it. */
  noteArrival(subId: string, now: number): void {
    this.arrivals.set(subId, now);
  }

  /** Somebody celebrates: if a colleague of the same room did a moment ago, they high-five. */
  noteCelebration(agentId: string, projectId: string, now: number): void {
    this.celebrated = this.celebrated.filter((c) => now - c.at < HIGHFIVE_WINDOW && c.agentId !== agentId);
    this.celebrated.push({ agentId, projectId, at: now });
  }

  /** A departing subagent: returns the order of the farewell handshake when its main agent is free to come. */
  farewell(people: readonly PersonView[], subId: string, now: number): EncounterOrder | null {
    const sub = people.find((p) => p.id === subId);
    const parent = sub?.parentId === undefined ? undefined : people.find((p) => p.id === sub.parentId);
    if (!sub || !parent || !available(parent) || parent.status === 'waiting') return null;
    if (now - this.lastStart < 1 || distance(parent, sub) > 18) return null;
    this.lastStart = now;
    return { kind: 'handshake', walker: parent.id, host: sub.id, bothWalk: false, duration: HANDSHAKE_SECONDS };
  }

  /** Orders to start now (at most one per call). */
  plan(people: readonly PersonView[], now: number): EncounterOrder[] {
    if (now - this.lastStart < GLOBAL_GAP[this.liveliness]) return [];
    const order = this.arrival(people, now) ?? this.highFive(people, now) ?? this.check(people, now);
    if (!order) return [];
    this.lastStart = now;
    return [order];
  }

  private byId(people: readonly PersonView[]): Map<string, PersonView> {
    return new Map(people.map((p) => [p.id, p]));
  }

  private arrival(people: readonly PersonView[], now: number): EncounterOrder | null {
    const index = this.byId(people);
    for (const [subId, since] of [...this.arrivals]) {
      const sub = index.get(subId);
      if (!sub || sub.leaving || now - since > ARRIVAL_PATIENCE) {
        this.arrivals.delete(subId);
        continue;
      }
      const parent = sub.parentId === undefined ? undefined : index.get(sub.parentId);
      if (!parent || !available(parent) || !sub.free) continue;
      this.arrivals.delete(subId);
      return { kind: 'handshake', walker: parent.id, host: sub.id, bothWalk: false, duration: HANDSHAKE_SECONDS };
    }
    return null;
  }

  private highFive(people: readonly PersonView[], now: number): EncounterOrder | null {
    this.celebrated = this.celebrated.filter((c) => now - c.at < HIGHFIVE_WINDOW);
    if (this.celebrated.length < 2) return null;
    const index = this.byId(people);
    for (let i = this.celebrated.length - 1; i > 0; i--) {
      const second = this.celebrated[i];
      const first = this.celebrated[i - 1];
      if (!second || !first || second.projectId !== first.projectId) continue;
      const a = index.get(first.agentId);
      const b = index.get(second.agentId);
      if (!a || !b || a.leaving || b.leaving || a.moving || b.moving) continue;
      if (a.status === 'waiting' || b.status === 'waiting') continue;
      if (a.areaId !== b.areaId || distance(a, b) > HIGHFIVE_MAX_DISTANCE) continue;
      const key = [a.id, b.id].sort().join('|');
      if (now - (this.lastHighFive.get(key) ?? -Infinity) < HIGHFIVE_COOLDOWN) continue;
      this.lastHighFive.set(key, now);
      this.celebrated = this.celebrated.filter((c) => c.agentId !== a.id && c.agentId !== b.id);
      return { kind: 'highfive', walker: a.id, host: b.id, bothWalk: true, duration: HIGHFIVE_SECONDS };
    }
    return null;
  }

  private check(people: readonly PersonView[], now: number): EncounterOrder | null {
    const subs = people.filter(
      (p) => p.kind === 'sub' && p.parentId !== undefined && p.free && !p.leaving && p.status === 'working',
    );
    const candidates = subs.filter((sub) => {
      const parent = people.find((p) => p.id === sub.parentId);
      if (!parent || !available(parent) || parent.status !== 'working') return false;
      return now - (this.lastChecked.get(parent.id) ?? -Infinity) >= CHECK_COOLDOWN[this.liveliness];
    });
    if (candidates.length === 0 || !this.rng.chance(CHECK_CHANCE)) return null;
    const sub = this.rng.pick(candidates);
    this.lastChecked.set(sub.parentId as string, now);
    return {
      kind: 'check',
      walker: sub.parentId as string,
      host: sub.id,
      bothWalk: false,
      duration: CHECK_SECONDS,
    };
  }

  /** People crossing in the corridor who greet each other with a wave. */
  waves(people: readonly PersonView[], now: number): WavePair[] {
    if (now - this.lastWaveAt < WAVE_GAP) return [];
    const walking = people.filter((p) => p.areaId === 'corridor' && p.moving && !p.leaving);
    for (let i = 0; i < walking.length; i++) {
      for (let j = i + 1; j < walking.length; j++) {
        const a = walking[i] as PersonView;
        const b = walking[j] as PersonView;
        if (distance(a, b) > WAVE_DISTANCE || !opposite(a.dir, b.dir)) continue;
        const key = [a.id, b.id].sort().join('|');
        if (now - (this.lastWave.get(key) ?? -Infinity) < WAVE_PAIR_COOLDOWN) continue;
        this.lastWave.set(key, now);
        if (!this.rng.chance(WAVE_CHANCE)) continue;
        this.lastWaveAt = now;
        return [{ a: a.id, b: b.id }];
      }
    }
    return [];
  }
}

const OPPOSITE: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };

function opposite(a: Dir, b: Dir): boolean {
  return OPPOSITE[a] === b;
}
