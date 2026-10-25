// What an idle person does away from the desk: coffee, the sofa, a chat, ping-pong. A plan is a list of steps at spots
// (claimed while in use); pairs share their start and end. Anything but idle, or reduced motion, cancels it at once.
import { approach, dirFromVector, type Actor, type ActivityPlan } from './actor';
import type { BubbleSpec } from './bubbles';
import type { SpotBook } from './spots';
import type { TilePos } from '../layout/types';
import type { SimOptions } from './types';
import { planWander, restDuration, type WanderResult } from './wander';

const CHAT_TURN_SECONDS = 3.4;
const CHAT_ICONS = ['💬', '☕', '😄', '🤔', '👍', '💡', '😅', '📈'] as const;

/** What the activities need from the simulation. */
export interface ActivityHost {
  now(): number;
  options(): SimOptions;
  readonly spots: SpotBook;
  actors(): readonly Actor[];
  actor(id: string): Actor | undefined;
  walk(a: Actor, tile: TilePos): boolean;
  goHome(a: Actor): void;
  walkToExit(a: Actor): void;
  bubble(a: Actor, spec: BubbleSpec): void;
}

export class Activities {
  constructor(private readonly host: ActivityHost) {}

  tryWander(a: Actor): void {
    const result = planWander(a, { spots: this.host.spots, actors: this.host.actors(), now: this.host.now() }, a.rng);
    if (!result) {
      a.idleDue = this.host.now() + 6 + a.rng.range(0, 6);
      return;
    }
    this.beginPlan(a, result);
  }

  private beginPlan(a: Actor, result: WanderResult): void {
    const claimAll = (actor: Actor, plan: ActivityPlan): boolean => {
      const first = plan.steps[0].spot;
      return this.host.spots.claim(first.id, actor.id);
    };
    if (!claimAll(a, result.plan)) return;
    if (result.partner && !claimAll(result.partner.actor, result.partner.plan)) {
      this.host.spots.release(result.plan.steps[0].spot.id, a.id);
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

  walkToStep(a: Actor): void {
    const step = a.activity?.steps[a.activity.index];
    if (!step) return this.host.goHome(a);
    if (!this.host.walk(a, step.spot.approach)) {
      this.cancel(a);
      this.host.goHome(a);
    }
  }

  arriveAtStep(a: Actor): void {
    const plan = a.activity;
    const step = plan?.steps[plan.index];
    if (!plan || !step) return this.host.goHome(a);
    a.phase = 'doing';
    a.moving = false;
    plan.ready = false;
    plan.endsAt = null;
    a.setPose('stand');
  }

  tick(a: Actor, dt: number): void {
    const plan = a.activity;
    const step = plan?.steps[plan.index];
    if (!plan || !step) return this.host.goHome(a);
    if (a.leaving) return this.host.walkToExit(a);
    const interrupted = a.agent.status !== 'idle' || this.host.options().reducedMotion;
    if (interrupted) {
      this.cancel(a);
      return this.host.goHome(a);
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
    const partner = plan.partnerId ? this.host.actor(plan.partnerId) : undefined;
    if (plan.partnerId) {
      const theirs = partner?.activity;
      if (!partner || !theirs || partner.leaving || (partner.phase !== 'doing' && partner.phase !== 'toActivity')) {
        this.finishActivity(a);
        return;
      }
      if (plan.endsAt === null) {
        if (!(partner.phase === 'doing' && theirs.ready)) return;
        const endsAt = this.host.now() + step.dur;
        plan.endsAt = endsAt;
        theirs.endsAt = endsAt;
      }
    } else if (plan.endsAt === null) plan.endsAt = this.host.now() + step.dur;

    if (step.pose === 'talk' || step.pose === 'listen') {
      const turn =
        Math.floor((this.host.now() + (step.pose === 'talk' ? 0 : CHAT_TURN_SECONDS)) / CHAT_TURN_SECONDS) % 2;
      a.setPose(turn === 0 ? 'talk' : 'listen');
      if (turn === 0) this.chatBubble(a);
    }
    if (plan.endsAt !== null && this.host.now() >= plan.endsAt) this.nextStep(a);
  }

  /** One small icon bubble per turn of a chat: no words, so nothing is made up. */
  private chatBubble(a: Actor): void {
    const slot = Math.floor(this.host.now() / CHAT_TURN_SECONDS);
    if (a.chatTurn === slot) return;
    a.chatTurn = slot;
    const icon = CHAT_ICONS[(slot + a.seed) % CHAT_ICONS.length] as string;
    this.host.bubble(a, { text: '', icon, importance: 12, sticky: false, ttl: 2.6, ambient: true });
  }

  private nextStep(a: Actor): void {
    const plan = a.activity;
    if (!plan) return;
    const nextIndex = plan.index + 1;
    const next = plan.steps[nextIndex];
    if (next && this.host.spots.claim(next.spot.id, a.id)) {
      this.host.spots.release(plan.steps[plan.index].spot.id, a.id);
      plan.index = nextIndex;
      a.phase = 'toActivity';
      this.walkToStep(a);
      return;
    }
    this.finishActivity(a);
  }

  private finishActivity(a: Actor): void {
    this.cancel(a);
    a.idleDue = this.host.now() + restDuration(a.rng, this.host.options().liveliness);
    this.host.goHome(a);
  }

  cancel(a: Actor): void {
    const plan = a.activity;
    if (!plan) return;
    for (const step of plan.steps) this.host.spots.release(step.spot.id, a.id);
    a.activity = null;
    a.carrying = null;
    a.seat = null;
  }
}
