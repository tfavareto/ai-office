// The Office model: tracked sessions -> agents, projects, feed and notices. Pure state + callbacks, no I/O.
import {
  type Account,
  type Activity,
  type ActivityDraft,
  type Agent,
  type AccountUsage,
  type DemoSimulator,
  type FeedItem,
  type Msg,
  type Notice,
  type NoticeLevel,
  DEMO_ACCOUNTS,
  type PendingHire,
  type PermissionRequest,
  type Project,
  durationMsg,
  fnv1a,
  msg,
  sourceText,
} from '@ai-office/shared';
import type { ParsedLine } from '../claude/types';
import type { SubagentMeta } from '../claude/paths';
import type { RegistryEntry } from '../claude/registry';
import type { ApplyEffects } from '../claude/transcript-state';
import type { Logger } from '../log';
import { newId } from '../util/ids';
import { type Overlay, buildMainAgent, buildSubAgent, mainAgentId, subAgentId } from './agent-builder';
import type { NameStore } from './name-store';
import {
  LEAVE_LINGER_MS,
  type SessionRecord,
  type SubRecord,
  createSessionRecord,
  createSubRecord,
  projectPathOf,
  sessionKey,
  subVisible,
} from './records';

const FEED_BACKLOG = 100;
const ERROR_NOTICE_GAP_MS = 20_000;

export interface OfficeOverlays {
  permissionFor(agentId: string): PermissionRequest | undefined;
  attentionFor(agentId: string): string | undefined;
}

export interface OfficeEvents {
  onChange(): void;
  onFeed(items: FeedItem[]): void;
  onNotice(notice: Notice): void;
  /** Live transcript event of an agent (used to cancel stale permission requests and attention marks). */
  onAgentEvent(agentId: string, effects: ApplyEffects, at: number): void;
}

export interface OfficeDeps {
  now: () => number;
  names: NameStore;
  log: Logger;
  overlays: OfficeOverlays;
  events: OfficeEvents;
}

export interface OfficeState {
  accounts: Account[];
  projects: Project[];
  agents: Agent[];
  /** Usage of demo accounts (empty when demo is off). */
  demoUsage: AccountUsage[];
  /** Simulated hires in progress (demo mode only). */
  demoHires: PendingHire[];
}

interface StatusMemo {
  status: Agent['status'];
  since: number;
}

export class Office {
  private accounts: Account[] = [];
  private readonly records = new Map<string, SessionRecord>();
  private readonly memo = new Map<string, StatusMemo>();
  private readonly projectOrders = new Map<string, number>();
  private readonly announce = new Set<string>();
  private readonly lastErrorNotice = new Map<string, number>();
  private feedBacklog: FeedItem[] = [];
  private demo: DemoSimulator | undefined;
  private lastFingerprint = '';
  private computed: OfficeState = { accounts: [], projects: [], agents: [], demoUsage: [], demoHires: [] };

  constructor(private readonly deps: OfficeDeps) {}

  // ---- inputs -------------------------------------------------------------------------------------------------

  setAccounts(accounts: Account[]): void {
    this.accounts = accounts;
  }

  setDemo(simulator: DemoSimulator | undefined): void {
    this.demo = simulator;
  }

  get demoSimulator(): DemoSimulator | undefined {
    return this.demo;
  }

  trackSession(
    account: Account,
    sessionId: string,
    registry: RegistryEntry | undefined,
    registryMode: boolean,
    announce: boolean,
  ): SessionRecord {
    const key = sessionKey(account.id, sessionId);
    const existing = this.records.get(key);
    if (existing !== undefined && existing.closedAt === undefined) {
      existing.registry = registry ?? existing.registry;
      return existing;
    }
    const record = createSessionRecord(account, sessionId, registry, registryMode, this.deps.now());
    this.records.set(key, record);
    if (announce) this.announce.add(key);
    return record;
  }

  record(key: string): SessionRecord | undefined {
    return this.records.get(key);
  }

  sessions(): IterableIterator<SessionRecord> {
    return this.records.values();
  }

  closeSession(key: string, announce: boolean): void {
    const record = this.records.get(key);
    if (record === undefined || record.closedAt !== undefined) return;
    record.closedAt = this.deps.now();
    this.announce.delete(key);
    if (announce) {
      const person = this.personOf(record, undefined);
      this.notice('info', msg('notice.left', { name: person.name }), mainAgentId(record), projectPathOf(record));
    }
  }

  ensureSub(record: SessionRecord, agentId: string, meta: SubagentMeta | undefined): SubRecord {
    const existing = record.subs.get(agentId);
    if (existing !== undefined) {
      if (meta !== undefined) existing.meta = meta;
      return existing;
    }
    const sub = createSubRecord(record, agentId, meta);
    record.subs.set(agentId, sub);
    return sub;
  }

  /** Applies parsed lines to a session (main when `subAgentId` is undefined). Lines older than `replayBefore` are history. */
  ingest(record: SessionRecord, sub: SubRecord | undefined, lines: readonly ParsedLine[], replayBefore: number): void {
    const state = sub === undefined ? record.main : sub.state;
    const agentId = sub === undefined ? mainAgentId(record) : subAgentId(record, sub.agentId);
    const items: FeedItem[] = [];
    for (const line of lines) {
      const effects = state.apply(line);
      if (!('at' in line) || line.at < replayBefore) continue;
      const person = this.personOf(record, sub);
      for (const activity of effects.activities) {
        items.push({
          id: activity.id,
          agentId,
          agentName: person.name,
          projectId: projectPathOf(record) ?? '',
          activity,
        });
      }
      this.noticesFor(record, sub, person.name, effects, line.at);
      this.deps.events.onAgentEvent(agentId, effects, line.at);
    }
    if (items.length > 0) this.publishFeed(items);
  }

  /** Records an activity that does not come from a transcript (message delivered, permission requested). */
  addExternalActivity(agentId: string, draft: ActivityDraft): Activity | undefined {
    const target = this.locate(agentId);
    if (target === undefined) return undefined;
    const now = this.deps.now();
    const state = target.sub === undefined ? target.record.main : target.sub.state;
    const activity = state.addExternal(draft, now);
    const person = this.personOf(target.record, target.sub);
    this.publishFeed([
      { id: activity.id, agentId, agentName: person.name, projectId: projectPathOf(target.record) ?? '', activity },
    ]);
    return activity;
  }

  // ---- demo ---------------------------------------------------------------------------------------------------

  tickDemo(now: number): void {
    if (this.demo === undefined) return;
    const result = this.demo.tick(now);
    if (result.feed.length > 0) this.publishFeed(result.feed);
    for (const notice of result.notices) this.deps.events.onNotice(notice);
  }

  // ---- queries ------------------------------------------------------------------------------------------------

  state(): OfficeState {
    return this.computed;
  }

  recentFeed(): FeedItem[] {
    return this.feedBacklog;
  }

  agentById(id: string): Agent | undefined {
    return this.computed.agents.find((agent) => agent.id === id);
  }

  /** Finds the agent a hook refers to: raw session id plus the optional raw subagent id. */
  findAgent(sessionId: string, rawAgentId?: string): Agent | undefined {
    const wantedSub =
      rawAgentId === undefined
        ? undefined
        : this.computed.agents.find(
            (a) => a.kind === 'sub' && a.sessionId === sessionId && a.id.endsWith(`:${rawAgentId}`),
          );
    if (wantedSub !== undefined) return wantedSub;
    return this.computed.agents.find((agent) => agent.kind === 'main' && agent.sessionId === sessionId);
  }

  /** Long activity history of an agent (real or demo). */
  history(agentId: string): Activity[] | undefined {
    const target = this.locate(agentId);
    if (target !== undefined)
      return (target.sub === undefined ? target.record.main : target.sub.state).activityHistory();
    return this.demo?.agents().find((agent) => agent.id === agentId)?.recent;
  }

  locate(agentId: string): { record: SessionRecord; sub: SubRecord | undefined } | undefined {
    for (const record of this.records.values()) {
      if (mainAgentId(record) === agentId) return { record, sub: undefined };
      if (!agentId.startsWith(`${record.key}:`)) continue;
      const rawSub = agentId.slice(record.key.length + 1);
      const sub = record.subs.get(rawSub);
      if (sub !== undefined) return { record, sub };
    }
    return undefined;
  }

  // ---- recompute ----------------------------------------------------------------------------------------------

  /** Recomputes agents and projects; fires `onChange` when anything visible changed. */
  refresh(now: number): void {
    this.computed = this.compute(now);
    const fingerprint = JSON.stringify([
      this.computed.agents,
      this.computed.projects,
      this.computed.accounts,
      this.computed.demoUsage,
      this.computed.demoHires,
    ]);
    if (fingerprint === this.lastFingerprint) return;
    this.lastFingerprint = fingerprint;
    this.deps.events.onChange();
  }

  private compute(now: number): OfficeState {
    const real: Agent[] = [];
    for (const [key, record] of this.records) {
      if (record.closedAt !== undefined && now - record.closedAt >= LEAVE_LINGER_MS) {
        this.records.delete(key);
        continue;
      }
      this.collect(record, now, real);
    }
    const realProjects = this.projectsFor(real);
    const memoIds = new Set<string>();
    const agents = real.map((agent) => this.withStatusSince(agent, now, memoIds));
    for (const id of this.memo.keys()) if (!memoIds.has(id)) this.memo.delete(id);
    if (this.demo === undefined)
      return { accounts: this.accounts, projects: realProjects, agents, demoUsage: [], demoHires: [] };
    // One snapshot: it advances the simulator first, so agents, projects and usage describe the same instant.
    const demo = this.demo.snapshot(now);
    const nextOrder = realProjects.reduce((max, project) => Math.max(max, project.order + 1), 0);
    const demoProjects = demo.projects.map((project): Project => ({ ...project, order: project.order + nextOrder }));
    return {
      accounts: [...this.accounts, ...DEMO_ACCOUNTS],
      projects: [...realProjects, ...demoProjects],
      agents: [...agents, ...demo.agents],
      demoUsage: demo.usage,
      demoHires: demo.hires ?? [],
    };
  }

  private collect(record: SessionRecord, now: number, out: Agent[]): void {
    const projectId = projectPathOf(record) ?? record.account.dir;
    const overlayFor = (id: string): Overlay => {
      const permission = this.deps.overlays.permissionFor(id);
      const attention = this.deps.overlays.attentionFor(id);
      return { ...(permission !== undefined ? { permission } : {}), ...(attention !== undefined ? { attention } : {}) };
    };
    const mainId = mainAgentId(record);
    const person = this.personOf(record, undefined);
    out.push(buildMainAgent(record, projectId, person, overlayFor(mainId), now));
    if (this.announce.delete(record.key))
      this.notice(
        'info',
        msg('notice.arrived', { name: person.name, project: projectId.split('/').pop() ?? projectId }),
        mainId,
        projectId,
      );
    for (const sub of record.subs.values()) {
      if (!sub.state.sawAny || !subVisible(record, sub, now)) continue;
      const subPerson = this.personOf(record, sub);
      out.push(
        buildSubAgent(record, sub, projectId, mainId, subPerson, overlayFor(subAgentId(record, sub.agentId)), now),
      );
    }
  }

  private projectsFor(agents: readonly Agent[]): Project[] {
    const present = new Set(agents.map((agent) => agent.projectId));
    for (const id of this.projectOrders.keys()) if (!present.has(id)) this.projectOrders.delete(id);
    const used = new Set(this.projectOrders.values());
    for (const id of present) {
      if (this.projectOrders.has(id)) continue;
      let order = 0;
      while (used.has(order)) order++;
      used.add(order);
      this.projectOrders.set(id, order);
    }
    return [...present]
      .map((id): Project => ({
        id,
        name: id.split('/').filter(Boolean).pop() ?? id,
        path: id,
        seed: fnv1a(id),
        order: this.projectOrders.get(id) ?? 0,
      }))
      .sort((a, b) => a.order - b.order);
  }

  private withStatusSince(agent: Agent, now: number, seen: Set<string>): Agent {
    seen.add(agent.id);
    const previous = this.memo.get(agent.id);
    if (previous === undefined) {
      this.memo.set(agent.id, { status: agent.status, since: agent.statusSince });
      return agent;
    }
    if (previous.status !== agent.status) {
      this.memo.set(agent.id, { status: agent.status, since: now });
      if (agent.status === 'waiting') this.alertWaiting(agent);
      return { ...agent, statusSince: now };
    }
    return { ...agent, statusSince: previous.since };
  }

  private alertWaiting(agent: Agent): void {
    const detail =
      agent.permission !== undefined
        ? (agent.permission.summaryMsg ?? agent.permission.summary)
        : (agent.waitingForMsg ?? agent.waitingFor);
    const message =
      detail === undefined
        ? msg('notice.needs', { name: agent.name })
        : msg('notice.needs.detail', { name: agent.name, detail });
    this.notice('alert', message, agent.id, agent.projectId, `alert:${agent.id}:${this.deps.now()}`);
  }

  // ---- helpers ------------------------------------------------------------------------------------------------

  private takenNames(): Set<string> {
    const taken = new Set<string>();
    for (const record of this.records.values()) {
      if (record.person !== undefined) taken.add(record.person.name);
      for (const sub of record.subs.values()) if (sub.person !== undefined) taken.add(sub.person.name);
    }
    return taken;
  }

  private personOf(record: SessionRecord, sub: SubRecord | undefined): { name: string; look: 'f' | 'm' } {
    const current = sub === undefined ? record.person : sub.person;
    if (current !== undefined) return current;
    const key = sub === undefined ? record.key : `${record.key}:${sub.agentId}`;
    const person = this.deps.names.assign(key, this.takenNames());
    if (sub === undefined) record.person = person;
    else sub.person = person;
    return person;
  }

  private noticesFor(
    record: SessionRecord,
    sub: SubRecord | undefined,
    name: string,
    effects: ApplyEffects,
    at: number,
  ): void {
    const agentId = sub === undefined ? mainAgentId(record) : subAgentId(record, sub.agentId);
    const projectId = projectPathOf(record);
    if (effects.turnCompleted !== undefined) {
      this.notice(
        'success',
        msg('notice.done', { name, duration: durationMsg(effects.turnCompleted.durationMs) }),
        agentId,
        projectId,
      );
    }
    if (effects.error !== undefined) {
      const last = this.lastErrorNotice.get(agentId) ?? 0;
      if (at - last >= ERROR_NOTICE_GAP_MS) {
        this.lastErrorNotice.set(agentId, at);
        this.notice('warn', msg('notice.error', { name, tool: effects.error.tool }), agentId, projectId);
      }
    }
  }

  private notice(level: NoticeLevel, message: Msg, agentId?: string, projectId?: string, id?: string): void {
    this.deps.events.onNotice({
      id: id ?? `n-${newId(6)}`,
      at: this.deps.now(),
      level,
      text: sourceText(message),
      msg: message,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    });
  }

  private publishFeed(items: FeedItem[]): void {
    this.feedBacklog = [...this.feedBacklog, ...items].slice(-FEED_BACKLOG);
    this.deps.events.onFeed(items);
  }
}
