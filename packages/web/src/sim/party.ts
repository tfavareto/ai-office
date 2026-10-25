// The social life of the office: turns snapshot transitions into celebrations (confetti, cheering, a bubble, clapping
// colleagues) and orders encounters between people. Everything it decides comes from the snapshots and the sim clock.
import type { OfficeSnapshot } from '@ai-office/shared';
import type { Actor } from './actor';
import type { BubbleSpec } from './bubbles';
import { CelebrationBook, CONFETTI_SCALE, type Grant } from './celebrations';
import { EffectQueue, type TileRect } from './effects';
import { EncounterDirector, type PersonView } from './encounters';
import type { SimOptions } from './types';
import { roomMilestone, TriggerTracker, type TriggerKind } from './triggers';

export interface PartyHost {
  now(): number;
  options(): SimOptions;
  actor(id: string): Actor | undefined;
  actors(): readonly Actor[];
  /** Tile rectangle of a layout area. */
  areaRect(areaId: string): TileRect | null;
  bubble(a: Actor, spec: BubbleSpec): void;
}

const PARTY_SECONDS = 2.4;
const BADGE_SECONDS = 3.5;
const REACT_SECONDS = 2.4;
const REACT_RADIUS = 12;
const MAX_REACTORS = 4;
const CELEBRATION_IMPORTANCE = 66;

interface Words {
  text: string;
  key: string;
}

const WORDS: Record<TriggerKind, Words> = {
  'tests-fixed': { text: 'Testes passando!', key: 'bubble.celebrate.tests' },
  'tasks-done': { text: 'Tudo pronto!', key: 'bubble.celebrate.tasks' },
  commit: { text: 'Commitado!', key: 'bubble.celebrate.commit' },
  'pr-merged': { text: 'Merge feito!', key: 'bubble.celebrate.merged' },
  'subagent-done': { text: 'Missão cumprida!', key: 'bubble.celebrate.sub' },
  'streak-end': { text: 'Sessão concluída!', key: 'bubble.celebrate.streak' },
};

const ROOM_WORDS: Words = { text: 'Sala toda em dia!', key: 'bubble.celebrate.room' };

const BIG: readonly TriggerKind[] = ['pr-merged', 'tasks-done', 'streak-end'];

export class Party {
  readonly effects = new EffectQueue();
  readonly director: EncounterDirector;
  private readonly tracker = new TriggerTracker();
  private readonly book = new CelebrationBook();
  private counter = 0;

  constructor(
    private readonly seed: number,
    private readonly host: PartyHost,
  ) {
    this.director = new EncounterDirector(seed);
  }

  configure(options: SimOptions): void {
    this.book.configure(options.liveliness);
    this.director.configure(options.liveliness);
  }

  reset(): void {
    this.tracker.reset();
    this.book.reset();
    this.director.reset();
    this.effects.clear();
  }

  /** Looks at a new snapshot and starts whatever celebrations it earns. */
  observe(snapshot: OfficeSnapshot): void {
    const triggers = this.tracker.update(snapshot);
    if (!this.host.options().celebrations) return;
    for (const trigger of triggers) {
      const roomDone = trigger.kind === 'tasks-done' && roomMilestone(snapshot.agents, trigger.projectId);
      const grant = this.book.request(trigger, this.host.now(), roomDone);
      if (grant) this.celebrate(grant);
    }
  }

  private celebrate(grant: Grant): void {
    const actor = this.host.actor(grant.agentId);
    if (!actor || actor.alpha < 0.5) return;
    const options = this.host.options();
    const big = grant.shower || BIG.includes(grant.kind);
    const words = grant.shower ? ROOM_WORDS : WORDS[grant.kind];
    this.effects.push({ type: 'sound', big });
    this.host.bubble(actor, {
      text: words.text,
      msg: { key: words.key },
      icon: '🎉',
      importance: CELEBRATION_IMPORTANCE,
      sticky: false,
      ttl: 3.6,
      tone: 'good',
      ...(grant.shower ? { anchor: 'room' as const } : {}),
    });
    this.director.noteCelebration(actor.id, actor.projectId, this.host.now());
    if (options.reducedMotion) {
      actor.badgeUntil = this.host.now() + BADGE_SECONDS;
      return;
    }
    const scale = CONFETTI_SCALE[options.liveliness];
    const seed = (this.seed + ++this.counter * 7919) >>> 0;
    if (actor.phase === 'atHome' && !actor.encounter) actor.partyUntil = this.host.now() + PARTY_SECONDS;
    this.effects.push({ type: 'burst', x: actor.x, y: actor.y, scale, big, seed });
    if (grant.shower) {
      const rect = actor.areaId ? this.host.areaRect(actor.areaId) : null;
      if (rect) this.effects.push({ type: 'shower', rect, scale, seed: seed ^ 0x9e37 });
    }
    this.cheerOn(actor);
  }

  /** Colleagues nearby who are not busy clap and turn toward the celebrant. */
  private cheerOn(celebrant: Actor): void {
    if (!celebrant.areaId) return;
    const near = this.host
      .actors()
      .filter(
        (p) =>
          p.id !== celebrant.id &&
          p.areaId === celebrant.areaId &&
          p.phase === 'atHome' &&
          !p.leaving &&
          !p.encounter &&
          p.agent.status === 'idle' &&
          Math.hypot(p.x - celebrant.x, p.y - celebrant.y) <= REACT_RADIUS,
      )
      .sort(
        (p, q) => Math.hypot(p.x - celebrant.x, p.y - celebrant.y) - Math.hypot(q.x - celebrant.x, q.y - celebrant.y),
      )
      .slice(0, MAX_REACTORS);
    for (const p of near) {
      p.reactUntil = this.host.now() + REACT_SECONDS;
      // they turn to the camera so the clapping reads
      p.reactFace = 's';
    }
  }

  /** What the director may use to decide. */
  views(): PersonView[] {
    return this.host.actors().map((a) => ({
      id: a.id,
      kind: a.kind,
      parentId: a.agent.parentId,
      projectId: a.projectId,
      areaId: a.areaId,
      x: a.x,
      y: a.y,
      dir: a.dir,
      status: a.agent.status,
      free: a.phase === 'atHome' && !a.encounter && !a.activity && !a.hiring && a.alpha > 0.9 && !!a.home,
      moving: a.moving,
      leaving: a.leaving,
    }));
  }
}
