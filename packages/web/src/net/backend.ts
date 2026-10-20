// Request/response side of the server API (everything except the SSE stream).
import { t } from '../i18n';
import type { Activity, BossMessage, DayStats, HireCheckResponse, HireRequest, PendingHire, PermissionDecision, RecentSession, TranscriptPage } from '@ai-office/shared';

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
  history(agentId: string): Promise<Activity[]>;
  transcript(query: TranscriptQuery): Promise<TranscriptPage>;
  sessions(): Promise<RecentSession[]>;
  day(date: string): Promise<DayStats>;
  setDemo(on: boolean): Promise<boolean>;
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
