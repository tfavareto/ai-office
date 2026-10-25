// `?mock=1`: a fully client-side office driven by the shared demo simulator (no server needed).
import {
  DEFAULT_TEAM_SHARE,
  RuleBook,
  applyCustomization,
  applyCustomizationPatch,
  autoAnswer,
  buildUsageDetail,
  createDemoSimulator,
  dayRange,
  emptyCustomization,
  demoDayReport,
  demoProgress,
  demoTimelapse,
  hourMapsFromRows,
  withOfficeSessions,
  type Customization,
  type DemoSimulator,
  type CodexSettings,
  type GitSettings,
  type HireCheckResponse,
  type HireRequest,
  type OfficeSnapshot,
  type PermissionDecision,
  type ProgressEventName,
  type RuleDraft,
  type RuleResult,
  type TeamHostStartRequest,
  type TeamJoinRequest,
  type TeamSharePrefs,
  type TeamStatus,
  type UsagePeriod,
} from '@ai-office/shared';
import { locale, t } from '../i18n';
import {
  BackendError,
  RuleRejectedError,
  TeamRejectedError,
  type Backend,
  type DecisionResult,
  type ReportQuery,
  type TimelapseQuery,
  type TranscriptQuery,
} from './backend';
import { MockLog, mockDay, mockSessions } from './mock-data';
import type { Transport, TransportHandlers } from './transport';

const TICK_MS = 250;
const SNAPSHOT_EVERY_MS = 1000;

/** `?demoLevel=` pins the level of the simulated office (to preview the decoration of every level). */
function pinnedLevel(): number | undefined {
  if (typeof location === 'undefined') return undefined;
  const value = Number(new URLSearchParams(location.search).get('demoLevel'));
  return Number.isInteger(value) && value >= 1 ? value : undefined;
}

/** The simulated office's progress, rebuilt only when the people or the day change. */
class MockProgress {
  private memo: { key: string; value: ReturnType<typeof demoProgress> } | undefined;
  private readonly level = pinnedLevel();

  of(snapshot: OfficeSnapshot, now: number): ReturnType<typeof demoProgress> {
    const agentNames = snapshot.agents.filter((agent) => agent.kind === 'main').map((agent) => agent.name);
    const projectNames = snapshot.projects.map((project) => project.name);
    const key = `${new Date(now).toDateString()}|${agentNames.join(',')}|${projectNames.join(',')}`;
    if (this.memo?.key !== key)
      this.memo = {
        key,
        value: demoProgress({
          now,
          agentNames,
          projectNames,
          ...(this.level !== undefined ? { level: this.level } : {}),
        }),
      };
    return this.memo.value;
  }
}

const mockProgress = new MockProgress();

/** Mock mode is "local" and "demo" by definition, so every feature is enabled. */
function asMockSnapshot(snapshot: OfficeSnapshot, now: number): OfficeSnapshot {
  return {
    ...snapshot,
    meta: { ...snapshot.meta, local: true, demo: true },
    progress: mockProgress.of(snapshot, now).summary,
  };
}

/** What the person customized in the demo: kept in memory, put on every snapshot like the server does. */
class MockCustomization {
  value: Customization = emptyCustomization();
  /** Tells the transport to publish a snapshot now. */
  changed: () => void = () => undefined;
}

class MockTransport implements Transport {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotAt = 0;
  private handlers: TransportHandlers | null = null;

  constructor(
    private readonly sim: DemoSimulator,
    private readonly log: MockLog,
    private readonly custom: MockCustomization,
    private readonly onSnapshot: (snapshot: OfficeSnapshot) => void,
  ) {
    custom.changed = () => {
      if (this.handlers !== null) this.push(this.handlers);
    };
  }

  connect(handlers: TransportHandlers): void {
    this.close();
    this.handlers = handlers;
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
    const raw = asMockSnapshot(this.sim.snapshot(now), now);
    const snapshot = {
      ...raw,
      ...applyCustomization({ projects: raw.projects, agents: raw.agents }, this.custom.value),
    };
    this.log.observe(snapshot);
    this.onSnapshot(snapshot);
    handlers.onSnapshot(snapshot);
  }
}

/** Throws what the server would answer for a refused rule. */
function unwrap<T>(result: RuleResult<T>): T {
  if (result.ok) return result.value;
  const { code, field, detail } = result.error;
  throw new RuleRejectedError(
    { error: code, ...(field !== undefined ? { field } : {}), ...(detail !== undefined ? { detail } : {}) },
    code === 'not-found' ? 404 : code === 'duplicate-rule' || code === 'too-many-rules' ? 409 : 400,
  );
}

class MockBackend implements Backend {
  latest: OfficeSnapshot | null = null;

  constructor(
    private readonly sim: DemoSimulator,
    private readonly log: MockLog,
    private readonly book: RuleBook,
    /** The demo's pull requests are fake; this switch only mirrors the setting so the screens behave as with a server. */
    private readonly pullRequests: { on: boolean },
    private readonly custom: MockCustomization,
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
    const agent = this.snapshot().agents.find(
      (candidate) =>
        candidate.sessionId === query.sessionId &&
        (query.agentId ? candidate.id === query.agentId : candidate.kind === 'main'),
    );
    return this.log.transcript(agent, query.after ?? 0);
  }

  async sessions() {
    return mockSessions(this.snapshot(), Date.now());
  }

  async day(date: string) {
    return mockDay(this.snapshot(), date);
  }

  async usageDetail(account: string, period: UsagePeriod) {
    const snapshot = this.snapshot();
    const now = Date.now();
    const rows = this.sim.usageRows(now);
    const maps = hourMapsFromRows(rows);
    const accounts = account === 'all' ? snapshot.accounts.map((candidate) => candidate.id) : [account];
    const detail = buildUsageDetail(rows, { accounts, label: account, period, now }, (id) => maps.get(id) ?? new Map());
    return { ...withOfficeSessions(detail, snapshot.agents), demo: true as const };
  }

  async dayReport(query: ReportQuery) {
    const range = dayRange(query.date);
    if (range === undefined) throw new BackendError(t('error.generic'), 400);
    const now = Date.now();
    return demoDayReport({
      range,
      now,
      locale: locale(),
      agents: this.sim.agents(),
      usageRows: this.sim.usageRows(now),
      account: query.account,
      includeRequests: query.includeRequests,
    });
  }

  async timelapse(query: TimelapseQuery) {
    const range = dayRange(query.date);
    if (range === undefined) throw new BackendError(t('error.generic'), 400);
    return demoTimelapse({
      range,
      now: Date.now(),
      locale: locale(),
      agents: this.sim.agents(),
      account: query.account,
    });
  }

  async progress(includeProject: boolean) {
    const view = mockProgress.of(this.snapshot(), Date.now()).progress;
    return includeProject || view.employee === undefined
      ? view
      : { ...view, employee: { name: view.employee.name, tasks: view.employee.tasks } };
  }

  async progressEvent(_event: ProgressEventName): Promise<void> {
    // The simulated office is not the user's: nothing done in it counts.
  }

  async setDemo(on: boolean): Promise<boolean> {
    return on;
  }

  async gitSettings(): Promise<GitSettings> {
    return { pullRequests: this.pullRequests.on, gh: 'unknown' };
  }

  async setGitPullRequests(on: boolean): Promise<GitSettings> {
    this.pullRequests.on = on;
    return this.gitSettings();
  }

  async codexSettings(): Promise<CodexSettings> {
    return { sessions: true, available: true, locked: false };
  }

  async setCodexSessions(_on: boolean): Promise<CodexSettings> {
    return this.codexSettings();
  }

  /** The demonstration has no network: team mode is not available in it. */
  async teamStatus(): Promise<TeamStatus> {
    return { available: false, role: null, sharing: { ...DEFAULT_TEAM_SHARE }, interfaces: [] };
  }

  private async teamRefused(): Promise<TeamStatus> {
    throw new TeamRejectedError('team-disabled', 409);
  }

  teamHostStart = (_request: TeamHostStartRequest): Promise<TeamStatus> => this.teamRefused();
  teamHostStop = (): Promise<TeamStatus> => this.teamRefused();
  teamNewCode = (): Promise<TeamStatus> => this.teamRefused();
  teamRevoke = (_memberId: string): Promise<TeamStatus> => this.teamRefused();
  teamEnd = (): Promise<TeamStatus> => this.teamRefused();
  teamJoin = (_request: TeamJoinRequest): Promise<TeamStatus> => this.teamRefused();
  teamLeave = (): Promise<TeamStatus> => this.teamRefused();
  teamSharing = (_prefs: TeamSharePrefs): Promise<TeamStatus> => this.teamRefused();

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

  async customization() {
    return this.custom.value;
  }

  async patchCustomization(patch: object) {
    const result = applyCustomizationPatch(this.custom.value, patch);
    if (!result.ok) throw new BackendError(result.error.error, 400);
    this.custom.value = result.value;
    this.custom.changed();
    return result.value;
  }

  async resetCustomization() {
    this.custom.value = emptyCustomization();
    this.custom.changed();
    return this.custom.value;
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
  const pullRequests = { on: true };
  const sim = createDemoSimulator({
    sessions: 4,
    pullRequests: () => pullRequests.on,
    autoDecide: (request, agent) =>
      autoAnswer(book, {
        toolName: request.toolName,
        input: request.input,
        summary: request.summary,
        projectPath: agent.projectId,
        accountId: agent.accountId,
        agentId: agent.id,
        agentName: agent.name,
        demo: true,
      })?.decision,
  });
  const log = new MockLog();
  const custom = new MockCustomization();
  const backend = new MockBackend(sim, log, book, pullRequests, custom);
  const transport = new MockTransport(sim, log, custom, (snapshot) => {
    backend.latest = snapshot;
  });
  return { transport, backend };
}
