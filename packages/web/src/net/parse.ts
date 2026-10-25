// Defensive parsing of everything that comes from the network: never trust external data.
import {
  parseLogFile,
  parseRulesFile,
  type Activity,
  type Agent,
  type AgentStats,
  type AutoDecision,
  type BossMessage,
  type DayStats,
  type FeedItem,
  type HireCheckResponse,
  type Notice,
  type OfficeSnapshot,
  type PendingHire,
  type PermissionRequest,
  type Project,
  type RecentSession,
  type Rule,
  type RuleErrorBody,
  type RulePreview,
  type TranscriptEntry,
  type TranscriptPage,
} from '@ai-office/shared';
import { t } from '../i18n';
import { parseProjectGit } from './parse-git';
import { parseProgressSummary } from './parse-progress';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function arr<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

const ACTIVITY_KINDS = new Set([
  'prompt',
  'think',
  'reply',
  'read',
  'search',
  'edit',
  'write',
  'bash',
  'web',
  'task',
  'subagent',
  'mcp',
  'question',
  'permission',
  'message',
  'error',
  'done',
  'other',
]);

export function isActivity(value: unknown): value is Activity {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.at === 'number' &&
    typeof value.kind === 'string' &&
    ACTIVITY_KINDS.has(value.kind) &&
    typeof value.text === 'string'
  );
}

export function isNotice(value: unknown): value is Notice {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.at === 'number' &&
    typeof value.text === 'string' &&
    (value.level === 'info' || value.level === 'success' || value.level === 'warn' || value.level === 'alert')
  );
}

function isFeedItem(value: unknown): value is FeedItem {
  return (
    isRecord(value) && typeof value.id === 'string' && typeof value.agentId === 'string' && isActivity(value.activity)
  );
}

const DEFAULT_STATS: AgentStats = {
  toolCalls: 0,
  tokensIn: 0,
  tokensOut: 0,
  linesAdded: 0,
  linesRemoved: 0,
  subagents: 0,
};

function isAgentLike(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.name === 'string'
  );
}

/** Fills the optional collections so the UI can iterate without null checks. */
function normalizeAgent(raw: Record<string, unknown>): Agent {
  const stats = isRecord(raw.stats) ? { ...DEFAULT_STATS, ...(raw.stats as Partial<AgentStats>) } : DEFAULT_STATS;
  const permission = isRecord(raw.permission)
    ? ({
        ...raw.permission,
        suggestions: arr(raw.permission.suggestions, (s): s is string => typeof s === 'string'),
      } as unknown as Agent['permission'])
    : undefined;
  return {
    ...(raw as unknown as Agent),
    kind: raw.kind === 'sub' ? 'sub' : 'main',
    recent: arr(raw.recent, isActivity),
    tasks: Array.isArray(raw.tasks) ? (raw.tasks as Agent['tasks']) : [],
    shells: Array.isArray(raw.shells) ? (raw.shells as Agent['shells']) : [],
    stats,
    permission,
  };
}

/** A project as the snapshot carries it, with its optional repository state validated (or dropped). */
function normalizeProject(raw: Record<string, unknown>): Project {
  const { git: rawState, ...rest } = raw;
  const state = parseProjectGit(rawState);
  return { ...(rest as unknown as Project), ...(state !== undefined ? { git: state } : {}) };
}

function isPendingHire(value: unknown): value is PendingHire {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.accountId === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.expiresAt === 'number' &&
    (value.deskIndex === undefined ||
      (typeof value.deskIndex === 'number' && Number.isInteger(value.deskIndex) && value.deskIndex >= 0)) &&
    (value.agentId === undefined || typeof value.agentId === 'string')
  );
}

/** Pending hires that survive validation; the snapshot omits the field when there are none. */
export function parseHires(data: unknown): PendingHire[] {
  return arr(data, isPendingHire);
}

export function parseHire(data: unknown): PendingHire {
  const hire = isRecord(data) ? data.hire : undefined;
  if (!isPendingHire(hire)) throw new Error(t('error.invalidResponse'));
  return hire;
}

const CHECK_REASONS = new Set(['not-absolute', 'not-found', 'not-directory', 'not-readable']);

export function parseFolderCheck(data: unknown): HireCheckResponse {
  if (!isRecord(data) || typeof data.ok !== 'boolean') throw new Error(t('error.invalidResponse'));
  const reason =
    typeof data.reason === 'string' && CHECK_REASONS.has(data.reason)
      ? (data.reason as HireCheckResponse['reason'])
      : undefined;
  return { ok: data.ok, ...(reason !== undefined ? { reason } : {}) };
}

export function parseSnapshot(data: unknown): OfficeSnapshot | null {
  if (!isRecord(data) || typeof data.rev !== 'number' || typeof data.serverTime !== 'number' || !isRecord(data.meta))
    return null;
  if (!Array.isArray(data.accounts) || !Array.isArray(data.projects) || !Array.isArray(data.agents)) return null;
  const meta = data.meta;
  const hires = parseHires(data.hires);
  const progress = parseProgressSummary(data.progress);
  return {
    rev: data.rev,
    serverTime: data.serverTime,
    meta: {
      version: str(meta.version, '0.0.0'),
      startedAt: num(meta.startedAt),
      local: meta.local === true,
      demo: meta.demo === true,
      build: typeof meta.build === 'string' ? meta.build : undefined,
      ...(meta.gitPullRequests === true ? { gitPullRequests: true } : {}),
    },
    accounts: data.accounts.filter(isRecord) as unknown as OfficeSnapshot['accounts'],
    projects: data.projects.filter(isRecord).map(normalizeProject),
    agents: data.agents.filter(isAgentLike).map(normalizeAgent),
    usage: Array.isArray(data.usage) ? (data.usage.filter(isRecord) as unknown as OfficeSnapshot['usage']) : [],
    ...(hires.length > 0 ? { hires } : {}),
    ...(progress !== undefined ? { progress } : {}),
  };
}

export function parseFeed(data: unknown): FeedItem[] {
  return arr(data, isFeedItem);
}

export function parseNotice(data: unknown): Notice | null {
  return isNotice(data) ? data : null;
}

function isBossMessage(value: unknown): value is BossMessage {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.agentId === 'string' &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'number' &&
    (value.status === 'queued' || value.status === 'delivered' || value.status === 'expired')
  );
}

export function parseMessages(data: unknown): BossMessage[] {
  return arr(isRecord(data) ? data.messages : data, isBossMessage);
}

export function parseActivities(data: unknown): Activity[] {
  return arr(isRecord(data) ? data.activities : data, isActivity);
}

const ENTRY_KINDS = new Set(['user', 'assistant', 'thinking', 'tool', 'system']);

function isTranscriptEntry(value: unknown): value is TranscriptEntry {
  if (
    !isRecord(value) ||
    typeof value.kind !== 'string' ||
    !ENTRY_KINDS.has(value.kind) ||
    typeof value.at !== 'number'
  )
    return false;
  if (value.kind === 'tool')
    return typeof value.name === 'string' && typeof value.summary === 'string' && typeof value.id === 'string';
  return typeof value.text === 'string';
}

export function parseTranscriptPage(data: unknown): TranscriptPage {
  if (!isRecord(data)) throw new Error(t('error.invalidResponse'));
  const entries = arr(data.entries, isTranscriptEntry);
  return {
    entries,
    next: num(data.next, entries.length),
    title: typeof data.title === 'string' ? data.title : undefined,
    open: data.open !== false,
  };
}

function isRecentSession(value: unknown): value is RecentSession {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    typeof value.accountId === 'string' &&
    typeof value.lastAt === 'number' &&
    typeof value.projectName === 'string'
  );
}

export function parseSessions(data: unknown): RecentSession[] {
  return arr(isRecord(data) ? data.sessions : data, isRecentSession);
}

export function parseDay(data: unknown): DayStats {
  if (!isRecord(data)) throw new Error(t('error.invalidResponse'));
  const agents = arr(
    data.agents,
    (item): item is DayStats['agents'][number] =>
      isRecord(item) && typeof item.agentId === 'string' && isRecord(item.ms),
  );
  return { date: str(data.date), agents };
}

/** `GET /api/permissions/:id`: the request with the tool input the rules look at. */
export function parsePermission(data: unknown): PermissionRequest {
  if (!isRecord(data) || typeof data.id !== 'string' || typeof data.toolName !== 'string')
    throw new Error(t('error.invalidResponse'));
  return {
    id: data.id,
    agentId: str(data.agentId),
    toolName: data.toolName,
    summary: str(data.summary),
    input: data.input,
    suggestions: [],
    createdAt: num(data.createdAt),
    expiresAt: num(data.expiresAt),
  };
}

/** Rules from `GET /api/rules`; anything unreadable is left out. */
export function parseRules(data: unknown): Rule[] {
  return parseRulesFile({ version: 1, rules: isRecord(data) ? data.rules : undefined }).rules;
}

export function parseRule(data: unknown): Rule {
  const [rule] = parseRulesFile({ version: 1, rules: [isRecord(data) ? data.rule : undefined] }).rules;
  if (rule === undefined) throw new Error(t('error.invalidResponse'));
  return rule;
}

/** The auto-decision log, newest first as the server sends it. */
export function parseRuleLog(data: unknown): AutoDecision[] {
  const entries = isRecord(data) ? data.entries : undefined;
  return parseLogFile({
    version: 1,
    entries: Array.isArray(entries) ? [...entries].reverse() : undefined,
  }).entries.reverse();
}

export function parseRulePreview(data: unknown): RulePreview {
  if (!isRecord(data)) throw new Error(t('error.invalidResponse'));
  return { matches: num(data.matches), total: num(data.total), since: num(data.since) };
}

/** The body of a refused rule (`{ error, field?, detail? }`), or undefined when the body is something else. */
export function parseRuleRejection(data: unknown): RuleErrorBody | undefined {
  if (!isRecord(data) || typeof data.error !== 'string') return undefined;
  return {
    error: data.error as RuleErrorBody['error'],
    ...(typeof data.field === 'string' ? { field: data.field as RuleErrorBody['field'] } : {}),
    ...(typeof data.detail === 'string' ? { detail: data.detail as RuleErrorBody['detail'] } : {}),
  };
}
