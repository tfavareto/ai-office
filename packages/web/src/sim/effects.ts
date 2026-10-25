// Visual and audible effects the simulation asks the renderers for. The renderers own the particles (pooled); the
// simulation only says where and how big. Taken once per frame by the world that owns the simulation.

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SimEffect =
  /** Confetti burst at a person (tile units); `scale` follows the animation level. */
  | { type: 'burst'; x: number; y: number; scale: number; big: boolean; seed: number }
  /** Confetti shower over a whole room (milestone). */
  | { type: 'shower'; rect: TileRect; scale: number; seed: number }
  /** A small pop of sparks (a high five). */
  | { type: 'spark'; x: number; y: number; seed: number }
  /** A celebration sound is due (the page plays it only when sounds are on). */
  | { type: 'sound'; big: boolean };

export const MAX_PENDING_EFFECTS = 32;

/** Bounded queue: when nobody takes the effects (a hidden tab), the oldest are dropped. */
export class EffectQueue {
  private items: SimEffect[] = [];

  push(effect: SimEffect): void {
    this.items.push(effect);
    if (this.items.length > MAX_PENDING_EFFECTS) this.items.splice(0, this.items.length - MAX_PENDING_EFFECTS);
  }

  take(): readonly SimEffect[] {
    const items = this.items;
    this.items = [];
    return items;
  }

  clear(): void {
    this.items = [];
  }
}
