import type { Spot, SpotKind } from '../layout/types';
import { Rng } from '../layout/rng';
import type { Actor, ActivityPlan, ActivityStep } from './actor';
import type { SpotBook } from './spots';
import type { Liveliness } from './bubbles';

export interface WanderContext {
  spots: SpotBook;
  actors: readonly Actor[];
  now: number;
}

export interface WanderResult {
  plan: ActivityPlan;
  partner?: { actor: Actor; plan: ActivityPlan };
}

interface Option {
  weight: number;
  build: () => WanderResult | null;
}

const REST_SECONDS: Record<Liveliness, [number, number]> = { calm: [45, 90], normal: [18, 45], lively: [8, 22] };

export function restDuration(rng: Rng, liveliness: Liveliness): number {
  const [min, max] = REST_SECONDS[liveliness];
  return rng.range(min, max);
}

function plan(steps: ActivityStep[]): ActivityPlan {
  return { steps, index: 0, endsAt: null, ready: false };
}

function dist(a: Actor, s: Spot): number {
  return Math.hypot(a.x - s.x, a.y - s.y);
}

function nearest(actor: Actor, spots: Spot[]): Spot | null {
  let best: Spot | null = null;
  for (const s of spots) if (!best || dist(actor, s) < dist(actor, best)) best = s;
  return best;
}

function pick<T>(rng: Rng, items: readonly T[]): T | null {
  return items.length ? rng.pick(items) : null;
}

/** Chooses the next thing an idle agent does away from its desk, or null when nothing is available. */
export function planWander(actor: Actor, ctx: WanderContext, rng: Rng): WanderResult | null {
  const { spots } = ctx;
  const single = (kind: SpotKind, area: string | undefined, pose: ActivityStep['pose'], min: number, max: number, carry?: 'cup'): (() => WanderResult | null) => () => {
    const spot = pick(rng, spots.free(kind, area, actor.id));
    return spot ? { plan: plan([{ spot, pose, dur: rng.range(min, max), carry }]) } : null;
  };

  const coffee = (): WanderResult | null => {
    const machine = spots.free('coffee', 'copa', actor.id)[0] ?? spots.free('vending', 'copa', actor.id)[0];
    if (!machine) return null;
    const steps: ActivityStep[] = [{ spot: machine, pose: 'coffee', dur: rng.range(6, 10), carry: 'cup' }];
    if (rng.chance(0.6)) {
      const seats = [...spots.free('stool', 'copa', actor.id), ...spots.free('cafe', 'copa', actor.id)];
      const seat = pick(rng, seats);
      if (seat) steps.push({ spot: seat, pose: 'sit', dur: rng.range(12, 26), carry: 'cup' });
    }
    return { plan: plan(steps) };
  };

  const pair = (kind: SpotKind, group: string | null, pose: 'talk' | 'play', min: number, max: number): (() => WanderResult | null) => () => {
    const partners = ctx.actors.filter(
      (a) => a.id !== actor.id && a.phase === 'atHome' && a.status === 'idle' && !a.leaving && !a.activity && a.agent.status === 'idle',
    );
    const partner = partners.length ? partners.reduce((b, a) => (Math.hypot(a.x - actor.x, a.y - actor.y) < Math.hypot(b.x - actor.x, b.y - actor.y) ? a : b)) : null;
    if (!partner) return null;
    const groups = new Map<string, Spot[]>();
    for (const s of spots.all()) {
      if (s.kind !== kind || !s.group || (group && s.group !== group)) continue;
      groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
    }
    const usable = [...groups.values()].filter((g) => g.length >= 2 && g.every((s) => spots.isFree(s.id)));
    const chosen = nearest(actor, usable.map((g) => g[0]));
    if (!chosen) return null;
    const [a, b] = usable.find((g) => g[0] === chosen)!;
    const dur = rng.range(min, max);
    const mine = a;
    const theirs = b;
    return {
      plan: { ...plan([{ spot: mine, pose, dur }]), partnerId: partner.id },
      partner: { actor: partner, plan: { ...plan([{ spot: theirs, pose: pose === 'talk' ? 'listen' : 'play', dur }]), partnerId: actor.id } },
    };
  };

  const options: Option[] = [
    { weight: 3, build: coffee },
    { weight: 1, build: single('cooler', 'corridor', 'coffee', 5, 8, 'cup') },
    { weight: 2, build: single('sofa', 'lounge', 'sit', 14, 32) },
    { weight: 1, build: single('beanbag', 'lounge', 'sit', 14, 30) },
    { weight: 1.2, build: single('arcade', 'lounge', 'arcade', 10, 22) },
    { weight: 0.8, build: single('bookshelf', 'lounge', 'read', 8, 14) },
    { weight: 0.5, build: single('sink', 'bathrooms', 'wash', 4, 6) },
    { weight: 0.8, build: single('sofa', 'reception', 'sit', 10, 20) },
    { weight: 0.7, build: single('bench', 'corridor', 'sit', 8, 16) },
    { weight: 3, build: pair('talk', null, 'talk', 9, 20) },
    { weight: 1.6, build: pair('pingpong', 'pingpong', 'play', 14, 26) },
  ];

  const pool = [...options];
  while (pool.length) {
    const total = pool.reduce((n, o) => n + o.weight, 0);
    let roll = rng.next() * total;
    let index = 0;
    for (; index < pool.length - 1; index++) {
      roll -= pool[index].weight;
      if (roll <= 0) break;
    }
    const result = pool[index].build();
    if (result) return result;
    pool.splice(index, 1);
  }
  return null;
}
