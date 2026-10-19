import { Rng } from '../layout/rng';
import type { Actor, ActivityPlan } from './actor';
import type { SpotBook } from './spots';
import type { Liveliness } from './bubbles';
export interface WanderContext {
    spots: SpotBook;
    actors: readonly Actor[];
    now: number;
}
export interface WanderResult {
    plan: ActivityPlan;
    partner?: {
        actor: Actor;
        plan: ActivityPlan;
    };
}
export declare function restDuration(rng: Rng, liveliness: Liveliness): number;
/** Chooses the next thing an idle agent does away from its desk, or null when nothing is available. */
export declare function planWander(actor: Actor, ctx: WanderContext, rng: Rng): WanderResult | null;
