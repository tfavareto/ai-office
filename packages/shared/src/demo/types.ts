// Contract of the demo simulator (implemented in ./simulator.ts): fake but realistic sessions used by the server's
// demo mode and by the web app's fully client-side `?mock=1` mode.
import type { Agent, BossMessage, FeedItem, Notice, OfficeSnapshot, PermissionDecision, Project } from '../model';

export interface DemoOptions {
  /** Deterministic seed (same seed + same clock = same story). */
  seed?: number;
  /** Number of projects with sessions (0-12, default 4). */
  sessions?: number;
  /** Time speed multiplier (default 1). */
  speed?: number;
  now?: () => number;
}

export interface DemoTick {
  feed: FeedItem[];
  notices: Notice[];
  /** Something visible changed (agents, statuses, activities). */
  changed: boolean;
}

export interface DemoSimulator {
  /** Advance the story to `now` (call ~4x per second). */
  tick(now: number): DemoTick;
  /** Demo agents and projects only (the server merges them with real ones). */
  agents(): Agent[];
  projects(): Project[];
  /** Full standalone snapshot (for `?mock=1`, with demo accounts and usage). */
  snapshot(now: number): OfficeSnapshot;
  /** Answer a demo permission request; false if it no longer exists. */
  decidePermission(requestId: string, decision: PermissionDecision): boolean;
  /** Deliver a message to demo agents after a short simulated delay. */
  sendMessage(agentIds: readonly string[], text: string, now: number): BossMessage[];
  messages(agentId: string): BossMessage[];
  /** Debug helper: open a new demo session (project with a main agent and `subs` subagents). */
  spawnSession(opts: { project: string; subs?: number; status?: Agent['status'] }): void;
}
