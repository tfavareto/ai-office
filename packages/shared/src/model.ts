// AI Office: data model shared by the server (which builds it from Claude Code data) and the web app (which draws it).
// Every timestamp is epoch milliseconds (server clock).
// Localization: texts the server or the demo generate come in two forms — `text`-like fields hold the pt-BR rendering
// (a fallback for old clients) and the matching `*Msg` field holds the localizable message (key + params) that the web
// app renders in the user's language. Texts that come from the user's own sessions (prompts, titles, commands) have
// no `Msg` and are shown as they are.
import type { Locale, Msg } from './i18n/i18n';
import type { ProjectGit } from './git';
import type { ProgressSummary } from './progress/types';
import type { UsageBurn, UsagePeaks } from './usage/types';
import type { AgentLook, RoomTheme } from './customization/types';

/** Which CLI a session comes from. Absent means Claude Code (every field of this kind is optional and additive). */
export type AgentSource = 'claude' | 'codex';

/**
 * A Claude Code configuration directory (one per account): ~/.claude, ~/.claude-work, CLAUDE_CONFIG_DIR... A Codex
 * home (CODEX_HOME, ~/.codex) is an account too, with `source: 'codex'`.
 */
export interface Account {
  id: string;
  /** Short label shown in chips ("Pessoal", or the folder name). */
  label: string;
  /** One letter for the account chip. */
  initial: string;
  /** Hex color that identifies the account everywhere in the UI. */
  color: string;
  /** Absolute path of the configuration directory. */
  dir: string;
  /** The default account (~/.claude): its label is localized by the client ("Pessoal", "Personal"…). */
  isDefault?: boolean;
  /** Localizable label (demo accounts). */
  labelMsg?: Msg;
  /** The CLI whose sessions live in `dir`; absent means Claude Code. */
  source?: AgentSource;
}

/** A project = a working directory. Each open project becomes a room in the office. */
export interface Project {
  /** Stable id: the absolute cwd. */
  id: string;
  /** Display name (last path segment). */
  name: string;
  path: string;
  /** Deterministic 32-bit seed (from the path) for colors and room variations. */
  seed: number;
  /** Order of arrival in the office (0 = first project opened). The client maps it to a room slot. */
  order: number;
  /** Git state of the folder (read-only); absent when it is not a repository or git could not be read. */
  git?: ProjectGit;
  /** The folder's name, when `name` shows an alias the person chose. */
  originalName?: string;
  /** Finishes chosen for the room (color, floor, walls, plants, sign). */
  theme?: RoomTheme;
  /** Pinned to the front of the building. */
  pinned?: boolean;
  /** Collapsed out of the building (the sidebar still lists it). */
  hidden?: boolean;
  /** Position in the order the person arranged the rooms in; absent for rooms never placed there. */
  rank?: number;
}

export type AgentKind = 'main' | 'sub';

/**
 * working: processing a turn · waiting: needs the user (permission, question) · idle: turn finished, session open ·
 * done: subagent finished (leaving the office) · offline: session closed (leaving the office).
 */
export type AgentStatus = 'working' | 'waiting' | 'idle' | 'done' | 'offline';

export type ActivityKind =
  | 'prompt'
  | 'think'
  | 'reply'
  | 'read'
  | 'search'
  | 'edit'
  | 'write'
  | 'bash'
  | 'web'
  | 'task'
  | 'subagent'
  | 'mcp'
  | 'question'
  | 'permission'
  | 'message'
  | 'error'
  | 'done'
  | 'other';

export interface Activity {
  id: string;
  at: number;
  kind: ActivityKind;
  /** One emoji. */
  icon: string;
  /** Short sentence (≤ 60 chars), e.g. "Editando App.tsx" (pt-BR fallback of `msg`). */
  text: string;
  /** Localizable form of `text`. */
  msg?: Msg;
  /** Longer detail (command, file path, query...), ≤ 400 chars. */
  detail?: string;
  /** Localizable form of `detail`, when the detail is generated text rather than data. */
  detailMsg?: Msg;
  durationMs?: number;
  error?: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  /** Localizable title (demo tasks only; real tasks come from the session as written). */
  titleMsg?: Msg;
  /** Present-tense form shown while in progress ("Rodando os testes"). */
  activeForm?: string;
  activeFormMsg?: Msg;
  status: 'pending' | 'in_progress' | 'completed';
  /** Epoch ms when the task entered its current status, when known (the task board shows its age). */
  changedAt?: number;
}

/** A long-running shell command the agent started (foreground or background) or a monitor. */
export interface ShellJob {
  id: string;
  label: string;
  labelMsg?: Msg;
  command?: string;
  background: boolean;
  kind: 'shell' | 'monitor';
  startedAt: number;
}

export interface AgentStats {
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  /** Estimated with public API prices for the model; undefined when unknown. */
  costUSD?: number;
  linesAdded: number;
  linesRemoved: number;
  subagents: number;
}

/** A pending permission request answered through the office (via the plugin hook). */
export interface PermissionRequest {
  id: string;
  agentId: string;
  toolName: string;
  /** Human summary ("npm test", "Editar src/app.ts"). */
  summary: string;
  /** Tool input, trimmed (shown on demand: command, diff...). */
  input?: unknown;
  /** Rules Claude Code suggested for "always allow" (shown as labels; answered by index). */
  suggestions: string[];
  /** Localizable form of each suggestion (same order and length as `suggestions`). */
  suggestionMsgs?: Msg[];
  /** Localizable form of `summary`, when it is generated text. */
  summaryMsg?: Msg;
  createdAt: number;
  expiresAt: number;
}

export type PermissionBehavior = 'allow' | 'deny' | 'terminal';

export interface PermissionDecision {
  behavior: PermissionBehavior;
  /** Index into PermissionRequest.suggestions to also remember the rule (allow only). */
  suggestion?: number;
  /** Reason sent to the agent (deny only). */
  message?: string;
  /** Stop the agent's turn (deny only). */
  interrupt?: boolean;
  /** Language of the person answering: the hook phrases what it tells the agent in it. */
  locale?: Locale;
  /** Set by the server when an approval rule answered (not a person): the hook words a denial accordingly. */
  auto?: 'rule';
}

export interface Agent {
  id: string;
  kind: AgentKind;
  sessionId: string;
  accountId: string;
  projectId: string;
  /** Main agent of a subagent. */
  parentId?: string;
  /** Friendly Brazilian first name, stable per agent ("Ana", "Bruno"). */
  name: string;
  /** "Principal" for main agents; the subagent type for subagents ("Explore", "general-purpose"...). */
  role: string;
  roleMsg?: Msg;
  /** Session title or the subagent's task description. */
  title?: string;
  /** Localizable title (demo agents only). */
  titleMsg?: Msg;
  look: 'f' | 'm';
  /** The name the office picked, when `name` shows one the person chose. */
  defaultName?: string;
  /** What the person chose to change about the look (agent, room and account choices already resolved). */
  appearance?: AgentLook;
  seed: number;
  status: AgentStatus;
  statusSince: number;
  /** What it is doing now (last activity). */
  activity?: Activity;
  /** Last activities, oldest first (≤ 30). */
  recent: Activity[];
  tasks: TaskItem[];
  shells: ShellJob[];
  stats: AgentStats;
  model?: string;
  gitBranch?: string;
  permissionMode?: string;
  /** Pending permission answered through the office (status is 'waiting' while it exists). */
  permission?: PermissionRequest;
  /** What it is waiting for, when status is 'waiting' without a permission ("Responder uma pergunta"). */
  waitingFor?: string;
  waitingForMsg?: Msg;
  startedAt: number;
  lastEventAt: number;
  /** The CLI this session runs in; absent means Claude Code. Codex agents are read-only (no hooks to answer through). */
  source?: AgentSource;
  /** Demo agent (not a real session). */
  demo?: boolean;
}

/** Plan usage per account, computed locally from transcripts (tokens and estimated cost). */
export interface AccountUsage {
  accountId: string;
  /** Rolling 5-hour window and current week (Monday 00:00 local). */
  window5h: { tokens: number; costUSD: number; resetsAt: number };
  week: { tokens: number; costUSD: number; resetsAt: number };
  today: { tokens: number; costUSD: number };
  /** Recent consumption: the input of the limit forecast. */
  burn?: UsageBurn;
  /** Highest completed 5 h block and week in the history: the estimated reference when no limit is configured. */
  peaks?: UsagePeaks;
}

export interface OfficeMeta {
  version: string;
  startedAt: number;
  /** Accessed from this computer (bind 127.0.0.1 + local Host): terminal view, permissions and messages work. */
  local: boolean;
  /** Demo agents are on. */
  demo: boolean;
  /** Build id of the web bundle the server is serving (pages reload when it changes). */
  build?: string;
  /** Pull requests of each room's branch are being asked of `gh` (off unless the person turned it on). */
  gitPullRequests?: boolean;
}

/**
 * An agent being hired from the office: a terminal window was opened for it and its session has not shown up yet.
 * The worlds draw a placeholder person walking to `deskIndex` until `agentId` appears (or `expiresAt` passes).
 */
export interface PendingHire {
  id: string;
  /** Room (project) the agent is hired into: the absolute project folder. */
  projectId: string;
  accountId: string;
  createdAt: number;
  /** The placeholder goes away at this time when no session matched. */
  expiresAt: number;
  /** Desk the person clicked (0-based, within the room); the placeholder sits there and the real agent inherits it. */
  deskIndex?: number;
  /** Set when the session appeared: the office agent that takes over the placeholder. */
  agentId?: string;
  /** Simulated by the demo (no terminal was opened). */
  demo?: boolean;
}

export interface OfficeSnapshot {
  /** Increases on every change. */
  rev: number;
  serverTime: number;
  meta: OfficeMeta;
  accounts: Account[];
  projects: Project[];
  agents: Agent[];
  usage: AccountUsage[];
  /** Agents being hired right now (a terminal is open, the session has not appeared). Absent when there are none. */
  hires?: PendingHire[];
  /** The office level, its recent unlocks and the employee of the month (see `progress/`). Absent until known. */
  progress?: ProgressSummary;
}

export interface FeedItem {
  id: string;
  agentId: string;
  agentName: string;
  projectId: string;
  activity: Activity;
}

export type NoticeLevel = 'info' | 'success' | 'warn' | 'alert';

export interface Notice {
  id: string;
  at: number;
  level: NoticeLevel;
  text: string;
  msg?: Msg;
  agentId?: string;
  projectId?: string;
}

/** Message the user ("the boss") sends to an agent; delivered to its session by the plugin hook. */
export interface BossMessage {
  id: string;
  agentId: string;
  text: string;
  createdAt: number;
  status: 'queued' | 'delivered' | 'expired';
  deliveredAt?: number;
  /** tool: after a tool call · stop: as a new instruction at the end of the turn · demo: simulated. */
  via?: 'tool' | 'stop' | 'demo';
  /** Same id for a message sent to the whole team of a room. */
  group?: string;
  /** Language of the sender: the hook phrases the delivery preamble in it. */
  locale?: Locale;
}

/** One entry of the read-only terminal view of a session. */
export type TranscriptEntry =
  | { kind: 'user'; at: number; text: string }
  | { kind: 'assistant'; at: number; text: string }
  | { kind: 'thinking'; at: number; text: string }
  | {
      kind: 'tool';
      at: number;
      id: string;
      name: string;
      /** Icon + pt-BR text ('📖 Lendo app.ts'). */
      summary: string;
      /** The icon and the localizable text of `summary`. */
      icon?: string;
      summaryMsg?: Msg;
      input?: unknown;
      result?: string;
      error?: boolean;
    }
  | { kind: 'system'; at: number; text: string; msg?: Msg };

export interface RecentSession {
  accountId: string;
  sessionId: string;
  projectPath: string;
  projectName: string;
  title?: string;
  titleMsg?: Msg;
  firstAt: number;
  lastAt: number;
  /** Still open (an agent is in the office). */
  open: boolean;
  agentId?: string;
}

/** Minutes per status per agent for "Meu dia". */
export interface DayStats {
  date: string;
  agents: { agentId: string; name: string; projectId: string; ms: Record<AgentStatus, number> }[];
}

// ---- Approval rules -------------------------------------------------------------------------------------------------

/** Why a request deserves a second look (destructive, privileged or hard to undo). */
export type RiskReason =
  'delete' | 'sudo' | 'force-push' | 'reset' | 'permissions' | 'pipe-shell' | 'disk' | 'data' | 'sensitive-file';

/** Why an allow rule never answers a request: a {@link RiskReason}, or code that runs inline (`bash -c`, `node -e`). */
export type RuleBlockReason = RiskReason | 'inline-code';

export type RuleEffect = 'allow' | 'deny';

/**
 * What a rule looks at. `command-prefix` (Bash): the command starts with these words. `exact`: the whole command, file,
 * URL or query. `path-glob` (file tools): `*` and `**` never match dot files. `host` (WebFetch): `docs.stripe.com` or
 * `*.stripe.com`. `any`: every request of the tool (`value` is empty).
 */
export type RuleMatcherKind = 'command-prefix' | 'exact' | 'path-glob' | 'host' | 'any';

export interface RuleMatcher {
  kind: RuleMatcherKind;
  value: string;
}

/** Where a rule applies. Everything omitted applies everywhere. */
export interface RuleScope {
  /** Absolute project path (the room): omitted = all projects. */
  projectPath?: string;
  accountId?: string;
}

/** A standing answer to a recurring permission request, taught by the user. */
export interface Rule {
  id: string;
  effect: RuleEffect;
  /** Tool name (`Bash`, `Edit`, `WebFetch`...) or an MCP prefix (`mcp__github__*`). */
  tool: string;
  matcher: RuleMatcher;
  scope: RuleScope;
  enabled: boolean;
  note?: string;
  /** Language the rule was written in: the reason sent to the agent follows it. */
  locale?: Locale;
  createdAt: number;
  hits: number;
  lastHitAt?: number;
}

/** allow/deny: a rule answered. ask: an allow rule matched but the request is risky, so you were asked. */
export type AutoDecisionOutcome = 'allow' | 'deny' | 'ask';

/** One entry of the auto-decision log (the last 500 are kept). */
export interface AutoDecision {
  id: string;
  at: number;
  outcome: AutoDecisionOutcome;
  /** The rule that matched, as it was then (the rule may have been edited or deleted since). */
  ruleId: string;
  effect: RuleEffect;
  tool: string;
  matcher: RuleMatcher;
  /** The tool the agent asked to use. */
  requestTool: string;
  /** Command, file, address or summary that was asked (cut, without URL queries). */
  subject: string;
  agentId: string;
  agentName: string;
  projectPath?: string;
  accountId?: string;
  /** Only for `ask`: what made the request risky. */
  blockedBy?: RuleBlockReason;
  demo?: boolean;
}
