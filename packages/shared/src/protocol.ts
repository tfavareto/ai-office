// HTTP + Server-Sent Events protocol between the AI Office server and the web app / plugin hooks.
import type { BossMessage, DayStats, FeedItem, Notice, OfficeSnapshot, PermissionDecision, RecentSession, TranscriptEntry } from './model';

/** Default port. Override with AI_OFFICE_PORT (server) — the plugin hooks read the same variable. */
export const DEFAULT_PORT = 4848;

/** SSE stream: GET /api/stream. Each message is a named event whose data is the JSON payload below. */
export interface StreamEvents {
  /** Full state (sent on connect and after changes, at most ~4 times per second). */
  snapshot: OfficeSnapshot;
  /** New feed items (on connect: the last 100). */
  feed: FeedItem[];
  notice: Notice;
}

export const API = {
  health: '/api/health',
  stream: '/api/stream',
  /** GET ?agent=<id> → { activities: Activity[] } (long history, up to 300). */
  history: '/api/history',
  /** GET ?session=<id>&account=<id>[&agent=<subagent id>][&after=<index>] → TranscriptPage. Local access only. */
  transcript: '/api/transcript',
  /** GET → { sessions: RecentSession[] } (last 7 days). Local access only. */
  sessions: '/api/sessions',
  /** GET ?date=YYYY-MM-DD → DayStats. */
  day: '/api/day',
  /** POST { on: boolean } → { demo } */
  demo: '/api/demo',
  /** Permissions (local access only). Hook: POST create + GET wait. Page: GET detail + POST decision. */
  permissions: '/api/permissions',
  /** Messages (local access only). Page: POST send + GET history. Hook: GET inbox + GET wait. */
  messages: '/api/messages',
  /** POST { session_id, agent_id?, message? } from the Notification hook: the agent needs the user (local only). */
  attention: '/api/attention',
} as const;

export interface HealthResponse {
  ok: true;
  version: string;
  local: boolean;
  demo: boolean;
  accounts: { id: string; dir: string; sessions: number }[];
}

export interface TranscriptPage {
  entries: TranscriptEntry[];
  /** Pass as `after` to get only newer entries. */
  next: number;
  title?: string;
  open: boolean;
}

export interface SessionsResponse {
  sessions: RecentSession[];
}

export type DayResponse = DayStats;

/** POST /api/permissions (hook) body — mirrors the Claude Code PermissionRequest hook input (trimmed). */
export interface PermissionHookRequest {
  session_id: string;
  tool_name: string;
  tool_input: unknown;
  permission_suggestions?: unknown[];
  agent_id?: string;
  cwd?: string;
  timeout_ms?: number;
}

/** 201 { id } — or 200 { skip: reason } when the office cannot answer (no page open, unknown session...). */
export type PermissionHookCreated = { id: string } | { skip: string };

/** GET /api/permissions/:id/wait?timeout=<s> → still pending, or the decision. */
export type PermissionWaitResponse =
  | { status: 'pending' }
  | ({ status: 'decided' } & PermissionDecision)
  | { status: 'expired' | 'cancelled' };

/** POST /api/permissions/:id/decision body = PermissionDecision → 200 { ok: true } | 409 already answered. */

/** POST /api/messages { agents: string[], text } → 201 { messages: BossMessage[] }; GET ?agent=<id> → { messages }. */
export interface MessagesResponse {
  messages: BossMessage[];
}

/**
 * GET /api/messages/inbox?session=&agent=&via=tool|stop → { messages: { id, text, createdAt }[] } | { skip }.
 * GET /api/messages/wait?session=&agent=&timeout=<s> → same shape; long-poll (≤ 25 s) used by the Stop hook.
 */
export type InboxResponse = { messages: { id: string; text: string; createdAt: number }[] } | { skip: string };
