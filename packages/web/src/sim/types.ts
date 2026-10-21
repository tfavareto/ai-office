import type { Agent, AgentKind, AgentStatus } from '@ai-office/shared';
import type { Dir, SpotKind } from '../layout/types';

/** Body poses the renderers know how to draw. */
export type Pose =
  | 'stand'
  | 'walk'
  | 'sit'
  | 'type'
  | 'hand'
  | 'coffee'
  | 'celebrate'
  | 'sleep'
  | 'lean'
  | 'stretch'
  | 'popcorn'
  | 'talk'
  | 'listen'
  | 'play'
  | 'arcade'
  | 'read'
  | 'wash';

/** What the character is sitting on (renderers lower the body accordingly); null when standing. */
export type SeatKind = SpotKind | null;

/** Read-only view of a character for renderers (2D and 3D). Positions are tile units, feet position. */
export interface Character {
  readonly id: string;
  readonly agentId: string;
  readonly name: string;
  readonly kind: AgentKind;
  readonly look: 'f' | 'm';
  readonly seed: number;
  readonly accountId: string;
  readonly projectId: string;
  readonly status: AgentStatus;
  /** Latest agent data from the snapshot. */
  readonly agent: Agent;
  readonly x: number;
  readonly y: number;
  readonly dir: Dir;
  readonly pose: Pose;
  /** Seconds spent in the current pose (animation time). */
  readonly poseT: number;
  /** Walk cycle phase in cycles. */
  readonly walkPhase: number;
  /** 0 hidden (inside the elevator) .. 1 fully visible. */
  readonly alpha: number;
  readonly seat: SeatKind;
  readonly moving: boolean;
  /** Layout area id the character is currently in, or null (corridor is 'corridor'). */
  readonly areaId: string | null;
  /** Shell wait stage 0-3 (lean, stretch, popcorn, sleep) while a foreground shell runs. */
  readonly shellStage: number;
  /** Holding a coffee cup. */
  readonly carrying: 'cup' | null;
  /** Raised hand / needs the user. */
  readonly alert: boolean;
  /** A placeholder for an agent being hired: not selectable, tagged "arriving". */
  readonly hiring: boolean;
}

export interface SimOptions {
  liveliness: 'calm' | 'normal' | 'lively';
  reducedMotion: boolean;
  bubbles: 'all' | 'important' | 'none';
}

export const DEFAULT_SIM_OPTIONS: SimOptions = { liveliness: 'normal', reducedMotion: false, bubbles: 'important' };

/** Fixed simulation step: 30 Hz. */
export const TICK = 1 / 30;
