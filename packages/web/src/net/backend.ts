// Request/response side of the server API (everything except the SSE stream).
import type { Activity, BossMessage, DayStats, PermissionDecision, RecentSession, TranscriptPage } from '@ai-office/shared';

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

/** Friendly pt-BR explanation of a failed request, for UI-facing messages. */
export function describeError(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.status === 403) return 'Disponível apenas ao abrir o AI Office neste computador (localhost).';
    if (error.status === 404) return 'Não encontrado: a sessão pode ter sido encerrada.';
    if (error.status === 409) return 'Esta solicitação já foi respondida.';
    if (error.status === 0) return 'Sem conexão com o servidor do AI Office.';
    if (error.status >= 500) return 'O servidor do AI Office teve um problema. Tente de novo.';
    return error.message || 'Não foi possível concluir a ação.';
  }
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'O servidor demorou demais para responder.';
  return 'Não foi possível concluir a ação.';
}
