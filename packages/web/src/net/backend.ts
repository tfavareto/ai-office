// Request/response side of the server API (everything except the SSE stream).
import { t } from '../i18n';
import type {
  Activity,
  AutoDecision,
  BossMessage,
  Customization,
  DayReport,
  DayStats,
  CodexSettings,
  GitSettings,
  HireCheckResponse,
  HireRequest,
  PendingHire,
  PermissionDecision,
  PermissionRequest,
  Progress,
  ProgressEventName,
  RecentSession,
  Rule,
  RuleDraft,
  RuleErrorBody,
  TeamErrorCode,
  TeamHostStartRequest,
  TeamJoinRequest,
  TeamSharePrefs,
  TeamStatus,
  RulePreview,
  Timelapse,
  TranscriptPage,
  UsageDetail,
  UsagePeriod,
} from '@ai-office/shared';

export interface TranscriptQuery {
  sessionId: string;
  accountId: string;
  /** Subagent id, when reading a subagent's transcript. */
  agentId?: string;
  after?: number;
}

export interface ReportQuery {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** An account id or "all". */
  account: string;
  /** Ask for the first line of each user prompt. */
  includeRequests: boolean;
}

export interface TimelapseQuery {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** An account id or "all". */
  account: string;
}

export type DecisionResult = 'ok' | 'already-answered';

export interface Backend {
  sendMessage(agentIds: readonly string[], text: string): Promise<BossMessage[]>;
  messages(agentId: string): Promise<BossMessage[]>;
  decidePermission(requestId: string, decision: PermissionDecision): Promise<DecisionResult>;
  /** The request with its tool input (the snapshot leaves the input out). */
  permission(requestId: string): Promise<PermissionRequest>;
  history(agentId: string): Promise<Activity[]>;
  transcript(query: TranscriptQuery): Promise<TranscriptPage>;
  sessions(): Promise<RecentSession[]>;
  day(date: string): Promise<DayStats>;
  /** What each agent did on one of the last seven days (local access only). */
  dayReport(query: ReportQuery): Promise<DayReport>;
  /** The day as a list of moments to replay at accelerated speed (local access only). */
  timelapse(query: TimelapseQuery): Promise<Timelapse>;
  /** Usage history of an account (`all` for every account) over today, this week or this month. */
  usageDetail(account: string, period: UsagePeriod): Promise<UsageDetail>;
  /** The office level, lifetime numbers and achievements (local access only); the project of the employee of the month only on request. */
  progress(includeProject: boolean): Promise<Progress>;
  /** Tells the server the person did something only the page can see, for the first time (local access only). */
  progressEvent(event: ProgressEventName): Promise<void>;
  setDemo(on: boolean): Promise<boolean>;
  /** Settings of the git integration that live on the server (local access only). */
  gitSettings(): Promise<GitSettings>;
  /** Turns the pull request lookup (the `gh` CLI, which uses the internet) on or off. */
  setGitPullRequests(on: boolean): Promise<GitSettings>;
  /** Settings of the Codex integration that live on the server (local access only). */
  codexSettings(): Promise<CodexSettings>;
  /** Turns the reading of Codex sessions on or off. */
  setCodexSessions(on: boolean): Promise<CodexSettings>;
  /** Team mode (local access only): the status, and the actions that host, join, share and leave. */
  teamStatus(): Promise<TeamStatus>;
  teamHostStart(request: TeamHostStartRequest): Promise<TeamStatus>;
  teamHostStop(): Promise<TeamStatus>;
  teamNewCode(): Promise<TeamStatus>;
  teamRevoke(memberId: string): Promise<TeamStatus>;
  teamEnd(): Promise<TeamStatus>;
  teamJoin(request: TeamJoinRequest): Promise<TeamStatus>;
  teamLeave(): Promise<TeamStatus>;
  teamSharing(prefs: TeamSharePrefs): Promise<TeamStatus>;
  rules(): Promise<Rule[]>;
  createRule(draft: RuleDraft): Promise<Rule>;
  /** Fields named in `patch` replace the rule's; `note: null` removes the note. */
  updateRule(id: string, patch: Partial<Omit<RuleDraft, 'note'>> & { note?: string | null }): Promise<Rule>;
  deleteRule(id: string): Promise<void>;
  /** The auto-decision log, newest first. */
  ruleLog(): Promise<AutoDecision[]>;
  clearRuleLog(): Promise<void>;
  /** How many of today's requests the rule would have answered. */
  previewRule(draft: RuleDraft): Promise<RulePreview>;
  /** Everything the person changed about names, looks, rooms and their order (local access only). */
  customization(): Promise<Customization>;
  /** A JSON merge patch of the customization: `null` resets a key. Resolves to the whole document. */
  patchCustomization(patch: object): Promise<Customization>;
  /** Back to the defaults for everything. */
  resetCustomization(): Promise<Customization>;
  /** Opens a terminal running Claude Code in the folder (local access only); the placeholder then arrives in the snapshot. */
  hireAgent(request: HireRequest): Promise<PendingHire>;
  /** Whether a folder can host a new agent (feedback while typing a path). */
  checkFolder(path: string): Promise<HireCheckResponse>;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

/** Team mode refused an action: `code` says why (the dialog explains it in the user's language). */
export class TeamRejectedError extends BackendError {
  constructor(
    readonly code: TeamErrorCode,
    status: number,
  ) {
    super(code, status);
    this.name = 'TeamRejectedError';
  }
}

/** A rule the server refused (too broad, dangerous, compound, duplicate...): `rejection` says why, by code. */
export class RuleRejectedError extends BackendError {
  constructor(
    readonly rejection: RuleErrorBody,
    status: number,
  ) {
    super(rejection.error, status);
    this.name = 'RuleRejectedError';
  }
}

/** Friendly explanation, in the current language, of a failed request (for UI-facing messages). */
export function describeError(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.status === 403) return t('hint.localOnly');
    if (error.status === 404) return t('error.notFound');
    if (error.status === 409) return t('error.alreadyAnswered');
    if (error.status === 0) return t('error.noConnection');
    if (error.status >= 500) return t('error.server');
    return error.message || t('error.generic');
  }
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))
    return t('error.timeout');
  return t('error.generic');
}
