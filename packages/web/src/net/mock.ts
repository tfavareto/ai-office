// `?mock=1`: a fully client-side office driven by the shared demo simulator (no server needed).
import { RuleBook, autoAnswer, createDemoSimulator, type DemoSimulator, type HireCheckResponse, type HireRequest, type OfficeSnapshot, type PermissionDecision, type RuleDraft, type RuleResult } from '@ai-office/shared';
import { locale, t } from '../i18n';
import { BackendError, RuleRejectedError, type Backend, type DecisionResult, type TranscriptQuery } from './backend';
import { MockLog, mockDay, mockSessions } from './mock-data';
import type { Transport, TransportHandlers } from './transport';

const TICK_MS = 250;
const SNAPSHOT_EVERY_MS = 1000;

/** Mock mode is "local" and "demo" by definition, so every feature is enabled. */
function asMockSnapshot(snapshot: OfficeSnapshot): OfficeSnapshot {
  return { ...snapshot, meta: { ...snapshot.meta, local: true, demo: true } };
}

class MockTransport implements Transport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotAt = 0;

  constructor(
    private readonly sim: DemoSimulator,
    private readonly log: MockLog,
    private readonly onSnapshot: (snapshot: OfficeSnapshot) => void,
  ) {}

  connect(handlers: TransportHandlers): void {
    this.close();
    handlers.onOpen();
    this.push(handlers);
    this.timer = setInterval(() => {
      const now = Date.now();
      const tick = this.sim.tick(now);
      if (tick.feed.length > 0) handlers.onFeed(tick.feed);
      for (const notice of tick.notices) handlers.onNotice(notice);
      if (tick.changed || now - this.lastSnapshotAt >= SNAPSHOT_EVERY_MS) this.push(handlers);
    }, TICK_MS);
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private push(handlers: TransportHandlers): void {
    const now = Date.now();
    this.lastSnapshotAt = now;
    const snapshot = asMockSnapshot(this.sim.snapshot(now));
    this.log.observe(snapshot);
    this.onSnapshot(snapshot);
    handlers.onSnapshot(snapshot);
  }
}

/** Throws what the server would answer for a refused rule. */
function unwrap<T>(result: RuleResult<T>): T {
  if (result.ok) return result.value;
  const { code, field, detail } = result.error;
  throw new RuleRejectedError({ error: code, ...(field !== undefined ? { field } : {}), ...(detail !== undefined ? { detail } : {}) }, code === 'not-found' ? 404 : code === 'duplicate-rule' || code === 'too-many-rules' ? 409 : 400);
}

class MockBackend implements Backend {
  latest: OfficeSnapshot | null = null;

  constructor(
    private readonly sim: DemoSimulator,
    private readonly log: MockLog,
    private readonly book: RuleBook,
  ) {}

  private snapshot(): OfficeSnapshot {
    if (!this.latest) throw new BackendError(t('error.mockOpening'), 503);
    return this.latest;
  }

  async sendMessage(agentIds: readonly string[], text: string) {
    return this.sim.sendMessage(agentIds, text, Date.now(), locale());
  }

  async messages(agentId: string) {
    return this.sim.messages(agentId);
  }

  async decidePermission(requestId: string, decision: PermissionDecision): Promise<DecisionResult> {
    return this.sim.decidePermission(requestId, decision) ? 'ok' : 'already-answered';
  }

  async permission(requestId: string) {
    const found = this.sim.agents().find((agent) => agent.permission?.id === requestId)?.permission;
    if (found === undefined) throw new BackendError(t('error.notFound'), 404);
    return found;
  }

  async history(agentId: string) {
    return this.log.activities(agentId);
  }

  async transcript(query: TranscriptQuery) {
    const agent = this.snapshot().agents.find((candidate) => candidate.sessionId === query.sessionId && (query.agentId ? candidate.id === query.agentId : candidate.kind === 'main'));
    return this.log.transcript(agent, query.after ?? 0);
  }

  async sessions() {
    return mockSessions(this.snapshot(), Date.now());
  }

  async day(date: string) {
    return mockDay(this.snapshot(), date);
  }

  async setDemo(on: boolean): Promise<boolean> {
    return on;
  }

  async rules() {
    return [...this.book.rules()];
  }

  async createRule(draft: RuleDraft) {
    return unwrap(this.book.create(draft));
  }

  async updateRule(id: string, patch: Parameters<Backend['updateRule']>[1]) {
    return unwrap(this.book.update(id, patch));
  }

  async deleteRule(id: string) {
    if (!this.book.remove(id)) throw new RuleRejectedError({ error: 'not-found' }, 404);
  }

  async ruleLog() {
    return this.book.log();
  }

  async clearRuleLog() {
    this.book.clearLog();
  }

  async previewRule(draft: RuleDraft) {
    return unwrap(this.book.preview(draft));
  }

  async hireAgent(request: HireRequest) {
    return this.sim.hire({
      project: request.projectPath,
      now: Date.now(),
      ...(request.accountId !== undefined ? { accountId: request.accountId } : {}),
      ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
      ...(request.deskIndex !== undefined ? { deskIndex: request.deskIndex } : {}),
    });
  }

  async checkFolder(path: string): Promise<HireCheckResponse> {
    return path.startsWith('/') ? { ok: true } : { ok: false, reason: 'not-absolute' };
  }
}

export function createMockEnvironment(): { transport: Transport; backend: Backend } {
  // The simulated office answers its own requests through the same rules engine as the server's.
  let ruleIds = 0;
  const book = new RuleBook({ now: Date.now, newId: () => `mock-rule-${++ruleIds}` });
  const sim = createDemoSimulator({
    sessions: 4,
    autoDecide: (request, agent) =>
      autoAnswer(book, { toolName: request.toolName, input: request.input, summary: request.summary, projectPath: agent.projectId, accountId: agent.accountId, agentId: agent.id, agentName: agent.name, demo: true })?.decision,
  });
  const log = new MockLog();
  const backend = new MockBackend(sim, log, book);
  const transport = new MockTransport(sim, log, (snapshot) => {
    backend.latest = snapshot;
  });
  return { transport, backend };
}
