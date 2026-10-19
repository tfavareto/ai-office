import type { AreaLayout, Door } from './types';
/**
 * The corridor between the two room rows: light stone floor, runner rugs, benches, water coolers and tall plants. Items
 * repeat every 16 tiles and never stand in front of a door, so every door stays reachable.
 */
export declare function layoutCorridor(endX: number, doors: readonly Door[]): AreaLayout;
