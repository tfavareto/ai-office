// Request/response side of the server API (everything except the SSE stream).
import { t } from '../i18n';
import type { Activity, AutoDecision, BossMessage, DayStats, HireCheckResponse, HireRequest, PendingHire, PermissionDecision, PermissionRequest, RecentSession, Rule, RuleDraft, RuleErrorBody, RulePreview, TranscriptPage, UsageDetail, UsagePeriod } from '@ai-office/shared';

export interface TranscriptQuery {
  sessionId: string;
  accountId: string;
  /** Subagent id, when reading a subagent's transcript. */
  agentId?: string;
  after?: number;
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
  /** Usage history of an account (`all` for every account) over today, this week or this month. */
  usageDetail(account: string, period: UsagePeriod): Promise<UsageDetail>;
  setDemo(on: boolean): Promise<boolean>;
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
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return t('error.timeout');
  return t('error.generic');
}
