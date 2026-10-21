// HTTP + Server-Sent Events protocol between the AI Office server and the web app / plugin hooks.
import type { Locale } from './i18n/i18n';
import type { AutoDecision, BossMessage, DayStats, FeedItem, Notice, OfficeSnapshot, PendingHire, PermissionDecision, RecentSession, Rule, TranscriptEntry } from './model';
import type { RuleBookErrorCode, RulePreview } from './rules';
import type { RuleDanger, RuleErrorCode, RuleField } from './rules/validate';

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

/**
 * Local authentication. The server keeps a random token in `<stateDir>/token` (mode 0600). Every /api/* route except
 * GET /api/health requires it: hooks send `Authorization: Bearer <token>`, the web app gets the HttpOnly,
 * SameSite=Strict cookie below when it loads the page.
 */
export const AUTH_COOKIE = 'ai_office_token';
/** File name of the token inside the state dir (AI_OFFICE_STATE_DIR, default ~/.ai-office). */
export const TOKEN_FILE_NAME = 'token';
/**
 * Server identity proof: `GET /api/health?challenge=<nonce>` answers `{ ok: true, proof }` with
 * `proof = hex(HMAC-SHA256(token, HEALTH_PROOF_PREFIX + nonce))`. Hooks check it before they send the token anywhere.
 */
export const HEALTH_CHALLENGE_PARAM = 'challenge';
export const HEALTH_PROOF_PREFIX = 'ai-office/health/v1:';

export const API = {
  /** GET → HealthResponse when authenticated, PublicHealthResponse otherwise (no token needed). */
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
  /**
   * GET ?date=YYYY-MM-DD (today or one of the 6 days before)&account=<id|all>[&requests=1][&locale=<locale>] → DayReport.
   * `requests=1` adds the first line of each user prompt; `locale` only picks the language of demo content.
   * Local access only.
   */
  report: '/api/report/day',
  /**
   * GET ?date=YYYY-MM-DD (today or one of the 6 days before)&account=<id|all> → Timelapse: the day as a time ordered
   * list of arrivals, status changes, activities, commits and test runs, to replay at accelerated speed. No message
   * bodies. Local access only.
   */
  timelapse: '/api/timelapse',
  /** GET ?account=<id|all>&period=today|week|month → UsageDetail (usage history index). Local access only. */
  usageDetail: '/api/usage/detail',
  /** GET → GitSettings · POST { pullRequests: boolean } → GitSettings. Local access only. */
  gitSettings: '/api/git/settings',
  /** POST { on: boolean } → { demo } */
  demo: '/api/demo',
  /** Permissions (local access only). Hook: POST create + GET wait. Page: GET detail + POST decision. */
  permissions: '/api/permissions',
  /** Messages (local access only). Page: POST send + GET history. Hook: POST inbox (consumes) + GET wait. */
  messages: '/api/messages',
  /** POST { session_id, agent_id?, message? } from the Notification hook: the agent needs the user (local only). */
  attention: '/api/attention',
  /**
   * Approval rules (local access only). GET → RulesResponse · POST RuleInput → 201 RuleResponse · PATCH /:id (partial) →
   * RuleResponse · DELETE /:id → { ok } · GET /log[?limit=] → RuleLogResponse · DELETE /log → { ok } ·
   * POST /preview RuleInput → RulePreview. A refused rule answers 400 RuleErrorBody.
   */
  rules: '/api/rules',
  /** POST HireRequest → 202 HireResponse: opens a terminal window running Claude Code in a project folder. Local access only. */
  hire: '/api/agents/hire',
  /** GET ?path=<absolute folder> → HireCheckResponse: whether a folder can host a new agent. Local access only. */
  hireCheck: '/api/agents/hire/check',
} as const;

export interface HealthResponse {
  ok: true;
  version: string;
  local: boolean;
  demo: boolean;
  accounts: { id: string; dir: string; sessions: number }[];
}

/** What GET /api/health reveals without the token. `proof` is present when a valid `challenge` was sent. */
export interface PublicHealthResponse {
  ok: true;
  proof?: string;
}

export interface TranscriptPage {
  /** At most 500 entries per page (the last 500 without `after`, the next 500 with it). */
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

/** POST /api/permissions/:id/decision body = PermissionDecision (optional `locale`: language of the answer, used by the hook) → 200 { ok: true } | 409 already answered. */

/** POST /api/messages { agents: string[], text, locale?: Locale } → 201 { messages: BossMessage[] }; GET ?agent=<id> → { messages }. */
export interface MessagesResponse {
  messages: BossMessage[];
}

/**
 * POST /api/messages/inbox { session, agent?, via: 'tool' | 'stop' } → { messages: { id, text, createdAt, locale? }[] } | { skip }.
 * (A POST because it consumes the queue.)
 * GET /api/messages/wait?session=&agent=&timeout=<s> → same shape; long-poll (≤ 25 s) used by the Stop hook.
 */
export type InboxResponse = { messages: { id: string; text: string; createdAt: number; locale?: Locale }[] } | { skip: string };

/** GET /api/rules */
export interface RulesResponse {
  rules: Rule[];
}

/** POST /api/rules, PATCH /api/rules/:id */
export interface RuleResponse {
  rule: Rule;
}

/** GET /api/rules/log: newest first, at most 500. */
export interface RuleLogResponse {
  entries: AutoDecision[];
}

export type RulePreviewResponse = RulePreview;

/** Body of a refused rule (HTTP 400; 404 unknown rule; 409 duplicate or too many rules): the web app explains `error`. */
export interface RuleErrorBody {
  error: RuleErrorCode | RuleBookErrorCode;
  field?: RuleField;
  detail?: RuleDanger;
}

// ---- hiring an agent ------------------------------------------------------------------------------------------------

/** Models offered when hiring; `default` leaves the choice to Claude Code. The others are `--model` aliases. */
export const HIRE_MODELS = ['default', 'opus', 'sonnet', 'haiku'] as const;
export type HireModel = (typeof HIRE_MODELS)[number];

/** Permission modes offered when hiring; `default` leaves the choice to Claude Code. The others are `--permission-mode` values. */
export const HIRE_PERMISSION_MODES = ['default', 'acceptEdits', 'plan'] as const;
export type HirePermissionMode = (typeof HIRE_PERMISSION_MODES)[number];

/** Longest initial prompt (characters) and folder path accepted. */
export const HIRE_MAX_PROMPT = 8000;
export const HIRE_MAX_PATH = 1024;
/** Highest desk index a request may carry (a room has 6 desks; the cap only bounds the input). */
export const HIRE_MAX_DESK_INDEX = 31;
/** How long a placeholder waits for the session to show up, and how long a taken-over placeholder lingers so every tab can hand over. */
export const HIRE_WINDOW_MS = 90_000;
export const HIRE_HANDOVER_MS = 6_000;

/** POST /api/agents/hire body. Every field but `projectPath` is optional. */
export interface HireRequest {
  /** Absolute path of an existing folder; its room is where the agent works. */
  projectPath: string;
  /** Account (Claude Code config dir) to run under; default: the default account, else the first one. */
  accountId?: string;
  /** First prompt, at most HIRE_MAX_PROMPT characters. */
  prompt?: string;
  model?: HireModel;
  permissionMode?: HirePermissionMode;
  /** Desk the person clicked in the room (the placeholder sits there). */
  deskIndex?: number;
  /** Language of the person hiring: used for the texts the launched terminal prints itself. */
  locale?: Locale;
}

/** 202 body: the hire is registered; the session shows up in the office when Claude Code starts. */
export interface HireResponse {
  hire: PendingHire;
}

/** Why a folder cannot host a new agent (GET /api/agents/hire/check). */
export type HireCheckReason = 'not-absolute' | 'not-found' | 'not-directory' | 'not-readable';

export interface HireCheckResponse {
  ok: boolean;
  reason?: HireCheckReason;
}

/** Error codes of POST /api/agents/hire (the `error` field of the JSON error body). */
export type HireErrorCode =
  | 'local-only'
  | 'rate-limited'
  | 'invalid-projectPath'
  | 'invalid-accountId'
  | 'invalid-prompt'
  | 'invalid-model'
  | 'invalid-permissionMode'
  | 'invalid-deskIndex'
  | 'invalid-locale'
  | 'unknown-account'
  | 'project-not-found'
  | 'project-not-directory'
  | 'project-not-readable'
  | 'claude-not-found'
  | 'no-terminal'
  | 'terminal-failed'
  | 'unsupported-platform';
