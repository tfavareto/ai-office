// `?mock=1`: a fully client-side office driven by the shared demo simulator (no server needed).
import { createDemoSimulator, type DemoSimulator, type OfficeSnapshot, type PermissionDecision } from '@ai-office/shared';
import { locale, t } from '../i18n';
import { BackendError, type Backend, type DecisionResult, type TranscriptQuery } from './backend';
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

class MockBackend implements Backend {
  latest: OfficeSnapshot | null = null;

  constructor(
    private readonly sim: DemoSimulator,
    private readonly log: MockLog,
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
}

export function createMockEnvironment(): { transport: Transport; backend: Backend } {
  const sim = createDemoSimulator({ sessions: 4 });
  const log = new MockLog();
  const backend = new MockBackend(sim, log);
  const transport = new MockTransport(sim, log, (snapshot) => {
    backend.latest = snapshot;
  });
  return { transport, backend };
}
