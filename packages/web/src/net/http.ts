// HTTP implementation of the Backend, speaking the protocol in @ai-office/shared.
import { API, type HireRequest, type PermissionDecision } from '@ai-office/shared';
import { locale, t } from '../i18n';
import { BackendError, type Backend, type DecisionResult, type TranscriptQuery } from './backend';
import { isRecord, parseActivities, parseDay, parseFolderCheck, parseHire, parseMessages, parseSessions, parseTranscriptPage } from './parse';

const REQUEST_TIMEOUT_MS = 15_000;

type FetchLike = typeof fetch;

export class HttpBackend implements Backend {
  constructor(
    private readonly baseUrl = '',
    private readonly fetchImpl: FetchLike = (...args) => fetch(...args),
  ) {}

  private url(path: string, params?: Record<string, string | number | undefined>): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) if (value !== undefined) query.set(key, String(value));
    const qs = query.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  private async request(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof DOMException) throw error;
      throw new BackendError(t('error.noConnection'), 0);
    }
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  }

  private async get(path: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
    const { status, body } = await this.request(this.url(path, params), { method: 'GET', headers: { Accept: 'application/json' } });
    if (status < 200 || status >= 300) throw new BackendError(errorText(body), status);
    return body;
  }

  private async post(path: string, payload: unknown, accept409 = false): Promise<{ status: number; body: unknown }> {
    const result = await this.request(this.url(path), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const ok = result.status >= 200 && result.status < 300;
    if (!ok && !(accept409 && result.status === 409)) throw new BackendError(errorText(result.body), result.status);
    return result;
  }

  async sendMessage(agentIds: readonly string[], text: string) {
    const { body } = await this.post(API.messages, { agents: agentIds, text, locale: locale() });
    return parseMessages(body);
  }

  async messages(agentId: string) {
    return parseMessages(await this.get(API.messages, { agent: agentId }));
  }

  async decidePermission(requestId: string, decision: PermissionDecision): Promise<DecisionResult> {
    const { status } = await this.post(`${API.permissions}/${encodeURIComponent(requestId)}/decision`, { ...decision, locale: locale() }, true);
    return status === 409 ? 'already-answered' : 'ok';
  }

  async history(agentId: string) {
    return parseActivities(await this.get(API.history, { agent: agentId }));
  }

  async transcript(query: TranscriptQuery) {
    return parseTranscriptPage(
      await this.get(API.transcript, { session: query.sessionId, account: query.accountId, agent: query.agentId, after: query.after }),
    );
  }

  async sessions() {
    return parseSessions(await this.get(API.sessions));
  }

  async day(date: string) {
    return parseDay(await this.get(API.day, { date }));
  }

  async hireAgent(request: HireRequest) {
    const { body } = await this.post(API.hire, { ...request, locale: locale() });
    return parseHire(body);
  }

  async checkFolder(path: string) {
    return parseFolderCheck(await this.get(API.hireCheck, { path }));
  }

  async setDemo(on: boolean): Promise<boolean> {
    const { body } = await this.post(API.demo, { on });
    return isRecord(body) && typeof body.demo === 'boolean' ? body.demo : on;
  }
}

function errorText(body: unknown): string {
  if (isRecord(body)) {
    if (typeof body.error === 'string') return body.error;
    if (typeof body.message === 'string') return body.message;
  }
  return '';
}
