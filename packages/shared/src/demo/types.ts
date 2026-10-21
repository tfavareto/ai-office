// Contract of the demo simulator (implemented in ./simulator.ts): fake but realistic sessions used by the server's
// demo mode and by the web app's fully client-side `?mock=1` mode.
import type { Locale } from '../i18n/i18n';
import type { Agent, BossMessage, FeedItem, Notice, OfficeSnapshot, PendingHire, PermissionDecision, PermissionRequest, Project } from '../model';
import type { UsageRow } from '../usage/types';

export interface DemoOptions {
  /** Deterministic seed (same seed + same clock = same story). */
  seed?: number;
  /** Number of projects with sessions (0-12, default 4). */
  sessions?: number;
  /** Time speed multiplier (default 1). */
  speed?: number;
  now?: () => number;
  /**
   * Asked for every permission request before it blocks an agent (the approval rules of the server answer here). A
   * decision answers the request on the spot; `undefined` leaves it for the user.
   */
  autoDecide?: (request: PermissionRequest, agent: Agent) => PermissionDecision | undefined;
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
  /** Hourly usage history of the demo accounts up to `now` (the numbers behind the usage cards and detail view). */
  usageRows(now: number): UsageRow[];
  /** Full standalone snapshot (for `?mock=1`, with demo accounts and usage). */
  snapshot(now: number): OfficeSnapshot;
  /** Answer a demo permission request; false if it no longer exists. */
  decidePermission(requestId: string, decision: PermissionDecision): boolean;
  /** Deliver a message to demo agents after a short simulated delay (`locale`: language of the sender). */
  sendMessage(agentIds: readonly string[], text: string, now: number, locale?: Locale): BossMessage[];
  messages(agentId: string): BossMessage[];
  /** Open a new demo session (project with a main agent and `subs` subagents). Returns the new agent's id. */
  spawnSession(opts: { project: string; subs?: number; status?: Agent['status']; accountId?: string; title?: string }): string;
  /** "Hire" a demo agent: a placeholder is pending for a few seconds, then a demo session opens in that room. */
  hire(opts: DemoHireOptions): PendingHire;
  /** Hires waiting for their session, and recently taken-over ones (what the snapshot carries). */
  hires(now: number): PendingHire[];
}

export interface DemoHireOptions {
  /** Project name or absolute path; unknown ones become a new demo project. */
  project: string;
  accountId?: string;
  /** The first prompt: it becomes the new agent's title. */
  prompt?: string;
  deskIndex?: number;
  now: number;
}
