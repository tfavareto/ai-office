// AI Office: data model shared by the server (which builds it from Claude Code data) and the web app (which draws it).
// Every timestamp is epoch milliseconds (server clock).
// Localization: texts the server or the demo generate come in two forms — `text`-like fields hold the pt-BR rendering
// (a fallback for old clients) and the matching `*Msg` field holds the localizable message (key + params) that the web
// app renders in the user's language. Texts that come from the user's own sessions (prompts, titles, commands) have
// no `Msg` and are shown as they are.
import type { Locale, Msg } from './i18n/i18n';

/** A Claude Code configuration directory (one per account): ~/.claude, ~/.claude-work, CLAUDE_CONFIG_DIR... */
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
