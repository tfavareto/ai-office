// Demo simulator: fake but realistic Claude Code sessions, driven by a deterministic event queue.
// Powers the server's demo mode and the web app's fully client-side `?mock=1` mode.
import type {
  AccountUsage,
  Activity,
  Agent,
  BossMessage,
  FeedItem,
  Notice,
  NoticeLevel,
  OfficeSnapshot,
  PendingHire,
  PermissionDecision,
  PermissionRequest,
  Project,
  ShellJob,
  TaskItem,
} from '../model';
import type { UsageRow } from '../usage/types';
import type { DemoHireOptions, DemoOptions, DemoSimulator, DemoTick } from './types';
import { type DemoSessionAnchor, demoAccountUsage, demoUsageRows } from './usage-history';
import {
  type ActivityDraft,
  describeToolUse,
  doneDraft,
  durationMsg,
  errorDraft,
  localizeDraft,
  messageDraft,
  permissionDraft,
  ruleDraft,
  promptDraft,
  replyDraft,
  thinkingDraft,
  toActivity,
} from '../activities';
import { fnv1a, mulberry32, pick, randInt } from '../hash';
import { HireBook } from '../hires';
import { HIRE_WINDOW_MS } from '../protocol';
import { type Locale, type Msg, msg, sourceText } from '../i18n';
import { pickName } from '../names';
import {
  DEMO_ACCOUNTS,
  DEMO_BRANCHES,
  DEMO_COMMANDS,
  DEMO_COMMIT_COMMAND,
  DEMO_TEST_COMMAND,
  DEMO_ERRORS,
  DEMO_GENERIC_PROMPT,
  DEMO_LONG_SHELLS,
  DEMO_MCP,
  DEMO_MODELS,
  DEMO_PERMISSIONS,
  DEMO_PROJECTS,
  DEMO_QUESTION,
  DEMO_SEARCHES,
  DEMO_SUBAGENTS,
  DEMO_TASK_PLAN,
  DEMO_WEB,
  type DemoCommand,
  type DemoError,
  type DemoPermissionSpec,
  type DemoProjectSpec,
  type DemoText,
} from './content';
import { demoGit } from './git';
import { EventQueue } from './event-queue';

const MAX_PROJECTS = 12;
const MAX_EVENTS_PER_ADVANCE = 20000;
const RECENT_LIMIT = 30;
const MESSAGE_LIMIT = 50;
const MESSAGE_DELIVERY_MS = 1500;
const LEAVE_LINGER_MS = 6000;
const SUB_LINGER_MS = 5000;
const PERMISSION_TIMEOUT_MS = 50_000;
const MAX_BLOCKED = 4;
/** Per step, the chance an agent blocks on a permission request, and (just above it) on a question. */
const PERMISSION_CHANCE = 0.07;
const QUESTION_CHANCE = 0.09;
const CHURN_MIN_MS = 70_000;
const CHURN_MAX_MS = 130_000;
const MAX_VISITORS = 2;
/** A hired demo agent "walks in" for this long before its session opens. */
const HIRE_ARRIVAL_MS = 4500;
const ERROR_NOTICE_GAP_MS = 20_000;
const MAX_DEMO_TASKS = 5;
const MOODS = ['shell', 'subs', 'idle', 'blocked', 'blocked', 'busy', 'idle', 'busy'] as const;

type Mood = (typeof MOODS)[number];
type Phase = 'idle' | 'working' | 'blocked' | 'gone';

interface Runtime {
  rng: () => number;
  phase: Phase;
  /** Bumped whenever the agent blocks or unblocks, so stale timeouts are ignored. */
  episode: number;
  /** Identifies the live chain of step events; older queued steps are ignored. */
  stepToken: number;
  stepsLeft: number;
  stepsTotal: number;
  turnStartedAt: number;
  pendingSubs: number;
  turnsLeft: number;
  visitor: boolean;
  spec: DemoProjectSpec;
  lastErrorAt: number;
  /** The last test run failed: the next one passes. */
  testsFailing: boolean;
}

interface ProjectEntry {
  spec: DemoProjectSpec;
  order: number;
  accountIndex: number;
}

/** Title fields of an agent: a generated text carries its message, a user's text (a delivered message) does not. */
function titleOf(title: DemoText | string): { title: string; titleMsg: Msg | undefined } {
  return typeof title === 'string' ? { title, titleMsg: undefined } : { title: title.text, titleMsg: title.msg };
}

/** Tasks before `done` are finished, the one at `done` is in progress and the rest wait. */
function demoTaskStatus(index: number, done: number): TaskItem['status'] {
  return index < done ? 'completed' : index === done ? 'in_progress' : 'pending';
}

/** A shell command whose description is generated (demo) text, so it has a localizable message. */
function commandDraft(command: DemoCommand): ActivityDraft {
  const description = msg('activity.bash.run', { text: command.description.msg });
  return localizeDraft(describeToolUse('Bash', { command: command.command }), description);
}

class Simulator implements DemoSimulator {
  private readonly seed: number;
  private readonly speed: number;
  private readonly clockFn: () => number;
  private readonly startedAt: number;
  private readonly rng: () => number;
  private readonly autoDecide: DemoOptions['autoDecide'];
  private readonly pullRequests: () => boolean;
  private readonly queue = new EventQueue();
  private readonly agentMap = new Map<string, Agent>();
  private readonly runtimes = new Map<string, Runtime>();
  private readonly projectMap = new Map<string, ProjectEntry>();
  private readonly messageMap = new Map<string, BossMessage[]>();
  private readonly hireBook = new HireBook();
  private pendingFeed: FeedItem[] = [];
  private pendingNotices: Notice[] = [];
  private clock: number;
  private changedSinceTick = false;
  private counter = 0;
  private permissionCursor = 0;
  private rev = 0;

  constructor(options: DemoOptions) {
    this.seed = options.seed ?? 1;
    this.speed = options.speed !== undefined && options.speed > 0 ? options.speed : 1;
    this.clockFn = options.now ?? Date.now;
    this.autoDecide = options.autoDecide;
    this.pullRequests = options.pullRequests ?? (() => true);
    this.startedAt = this.clockFn();
    this.clock = this.startedAt;
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);
    const projectCount = Math.max(0, Math.min(MAX_PROJECTS, options.sessions ?? 4));
    let moodIndex = 0;
    for (let i = 0; i < projectCount; i++) {
      const spec = DEMO_PROJECTS[i % DEMO_PROJECTS.length] as DemoProjectSpec;
      const mains = i % 2 === 0 ? 2 : 1;
      for (let m = 0; m < mains; m++) {
        this.addInitialMain(spec, i, MOODS[moodIndex % MOODS.length] as Mood, moodIndex);
        moodIndex++;
      }
    }
    this.scheduleChurn(this.startedAt);
  }

  // ---- public API -------------------------------------------------------------------------------------------

  tick(now: number): DemoTick {
    this.advance(now);
    const result: DemoTick = { feed: this.pendingFeed, notices: this.pendingNotices, changed: this.changedSinceTick };
    this.pendingFeed = [];
    this.pendingNotices = [];
    this.changedSinceTick = false;
    return result;
  }

  agents(): Agent[] {
    return Array.from(this.agentMap.values());
  }

  projects(): Project[] {
    const active = new Set(Array.from(this.agentMap.values()).map((agent) => agent.projectId));
    return Array.from(this.projectMap.entries())
      .filter(([path]) => active.has(path))
      .map(([path, entry]) => ({
        id: path,
        name: entry.spec.name,
        path,
        seed: fnv1a(path),
        order: entry.order,
        git: demoGit(
          DEMO_PROJECTS.findIndex((candidate) => candidate.path === path),
          this.startedAt,
          this.pullRequests(),
        ),
      }))
      .sort((a, b) => a.order - b.order);
  }

  snapshot(now: number): OfficeSnapshot {
    this.advance(now);
    const hires = this.hireBook.list(now);
    return {
      rev: this.rev,
      serverTime: now,
      meta: { version: 'demo', startedAt: this.startedAt, local: true, demo: true },
      accounts: DEMO_ACCOUNTS.map((account) => ({ ...account })),
      projects: this.projects(),
      agents: this.agents(),
      usage: this.usage(now),
      ...(hires.length > 0 ? { hires } : {}),
    };
  }

  hires(now: number): PendingHire[] {
    return this.hireBook.list(now);
  }

  decidePermission(requestId: string, decision: PermissionDecision): boolean {
    for (const agent of this.agentMap.values()) {
      if (agent.permission?.id !== requestId) continue;
      const runtime = this.runtimes.get(agent.id);
      if (runtime === undefined) return false;
      this.resolveBlock(agent.id, runtime.episode, decision, this.clock);
      this.touch();
      return true;
    }
    return false;
  }

  sendMessage(agentIds: readonly string[], text: string, now: number, locale?: Locale): BossMessage[] {
    this.advance(now);
    const targets = agentIds.filter((id) => this.agentMap.has(id));
    const group = targets.length > 1 ? this.nextId('demo-group') : undefined;
    return targets.map((agentId) => {
      const message: BossMessage = {
        id: this.nextId('demo-msg'),
        agentId,
        text,
        createdAt: now,
        status: 'queued',
        ...(group !== undefined ? { group } : {}),
        ...(locale !== undefined ? { locale } : {}),
      };
      this.storeMessage(message);
      this.queue.push(now + this.scale(MESSAGE_DELIVERY_MS), (at) => this.deliverMessage(message.id, agentId, at));
      return message;
    });
  }

  messages(agentId: string): BossMessage[] {
    return [...(this.messageMap.get(agentId) ?? [])];
  }

  spawnSession(opts: {
    project: string;
    subs?: number;
    status?: Agent['status'];
    accountId?: string;
    title?: string;
  }): string {
    const spec = this.specFor(opts.project);
    const id = this.createMain(spec, this.projectIndexOf(spec), this.clock, false, 1, {
      accountId: opts.accountId,
      title: opts.title,
    });
    this.noticeFor(id, 'info', msg('notice.opened', { name: this.nameOf(id), project: spec.name }), this.clock);
    const status = opts.status ?? 'working';
    if (status === 'idle') {
      this.beginIdle(id, this.clock);
    } else if (status === 'waiting') {
      this.startTurn(id, this.clock);
      this.blockOnPermission(id, this.clock);
    } else if (status === 'offline' || status === 'done') {
      this.leave(id, this.clock);
    } else {
      this.startTurn(id, this.clock, opts.title);
    }
    if (opts.subs !== undefined && opts.subs > 0 && this.runtimes.get(id)?.phase === 'working') {
      this.spawnSubs(id, this.clock, opts.subs);
    }
    this.touch();
    return id;
  }

  hire(opts: DemoHireOptions): PendingHire {
    this.advance(opts.now);
    const spec = this.specFor(opts.project);
    const accountId = this.accountIdFor(spec, opts.accountId);
    const prompt = opts.prompt?.trim();
    const hire: PendingHire = {
      id: this.nextId('hire'),
      projectId: spec.path,
      accountId,
      createdAt: this.clock,
      expiresAt: this.clock + HIRE_WINDOW_MS,
      demo: true,
      ...(opts.deskIndex !== undefined ? { deskIndex: opts.deskIndex } : {}),
    };
    this.hireBook.add(hire);
    this.queue.push(this.clock + this.scale(HIRE_ARRIVAL_MS), (at) => {
      const agentId = this.spawnSession({
        project: spec.path,
        accountId,
        ...(prompt ? { title: prompt.slice(0, 80) } : {}),
      });
      this.hireBook.resolve(hire.id, agentId, at);
    });
    this.touch();
    return hire;
  }

  // ---- time -------------------------------------------------------------------------------------------------

  private advance(now: number): void {
    let processed = 0;
    for (let event = this.queue.popDue(now); event !== undefined; event = this.queue.popDue(now)) {
      this.clock = Math.max(this.clock, event.at);
      event.run(event.at);
      this.touch();
      if (++processed >= MAX_EVENTS_PER_ADVANCE) break;
    }
    this.clock = Math.max(this.clock, now);
    this.hireBook.sweep(this.clock);
  }

  private touch(): void {
    if (!this.changedSinceTick) this.rev++;
    this.changedSinceTick = true;
  }

  private scale(ms: number): number {
    return ms / this.speed;
  }

  private dwell(rng: () => number, minMs: number, maxMs: number): number {
    return this.scale(randInt(rng, minMs, maxMs));
  }

  private nextId(prefix: string): string {
    this.counter++;
    return `${prefix}-${this.counter.toString(36)}`;
  }

  // ---- agents -----------------------------------------------------------------------------------------------

  private takenNames(): Set<string> {
    return new Set(Array.from(this.agentMap.values()).map((agent) => agent.name));
  }

  private nameOf(id: string): string {
    return this.agentMap.get(id)?.name ?? 'Alguém';
  }

  private update(id: string, change: (agent: Agent) => Agent): void {
    const current = this.agentMap.get(id);
    if (current !== undefined) this.agentMap.set(id, change(current));
  }

  private setStatus(id: string, status: Agent['status'], at: number, extra: Partial<Agent> = {}): void {
    this.update(id, (agent) => ({ ...agent, status, statusSince: at, ...extra }));
  }

  private specFor(project: string): DemoProjectSpec {
    const known = DEMO_PROJECTS.find((spec) => spec.name === project || spec.path === project);
    if (known !== undefined) return known;
    const path = project.includes('/') ? project : `/Users/demo/projetos/${project}`;
    const name = path.split('/').filter(Boolean).pop() ?? project;
    return {
      name,
      path,
      files: [`${path}/src/index.ts`, `${path}/README.md`, `${path}/package.json`],
      prompts: [DEMO_GENERIC_PROMPT],
    };
  }

  private ensureProject(spec: DemoProjectSpec, accountIndex: number): void {
    if (this.projectMap.has(spec.path)) return;
    const used = new Set(Array.from(this.projectMap.values()).map((entry) => entry.order));
    let order = 0;
    while (used.has(order)) order++;
    this.projectMap.set(spec.path, { spec, order, accountIndex });
  }

  private releaseProjectIfEmpty(path: string): void {
    const stillUsed = Array.from(this.agentMap.values()).some((agent) => agent.projectId === path);
    if (!stillUsed) this.projectMap.delete(path);
  }

  private projectIndexOf(spec: DemoProjectSpec): number {
    return Math.max(
      0,
      DEMO_PROJECTS.findIndex((candidate) => candidate.path === spec.path),
    );
  }

  /** `requested` when it is a demo account; otherwise the account the project belongs to. */
  private accountIdFor(spec: DemoProjectSpec, requested?: string): string {
    const known = DEMO_ACCOUNTS.find((account) => account.id === requested);
    return (known ?? DEMO_ACCOUNTS[this.projectIndexOf(spec) % DEMO_ACCOUNTS.length] ?? DEMO_ACCOUNTS[0]).id;
  }

  private createMain(
    spec: DemoProjectSpec,
    projectIndex: number,
    at: number,
    visitor: boolean,
    turns: number,
    overrides: { accountId?: string | undefined; title?: string | undefined } = {},
  ): string {
    const accountIndex = projectIndex % DEMO_ACCOUNTS.length;
    this.ensureProject(spec, accountIndex);
    const id = this.nextId('demo');
    const person = pickName(`${this.seed}:${id}`, this.takenNames());
    const rng = mulberry32(fnv1a(`${this.seed}:${id}`));
    const agent: Agent = {
      id,
      kind: 'main',
      sessionId: `demo-session-${id}`,
      accountId: overrides.accountId ?? (DEMO_ACCOUNTS[accountIndex] ?? DEMO_ACCOUNTS[0]).id,
      projectId: spec.path,
      name: person.name,
      role: sourceText(msg('agent.role.main')),
      roleMsg: msg('agent.role.main'),
      ...titleOf(overrides.title ?? pick(rng, spec.prompts)),
      look: person.look,
      seed: fnv1a(id),
      status: 'idle',
      statusSince: at,
      recent: [],
      tasks: [],
      shells: [],
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 },
      model: pick(rng, DEMO_MODELS),
      gitBranch: pick(rng, DEMO_BRANCHES),
      permissionMode: 'default',
      startedAt: at,
      lastEventAt: at,
      demo: true,
    };
    this.agentMap.set(id, agent);
    this.runtimes.set(id, {
      rng,
      phase: 'idle',
      episode: 0,
      stepToken: 0,
      stepsLeft: 0,
      stepsTotal: 1,
      turnStartedAt: at,
      pendingSubs: 0,
      turnsLeft: turns,
      visitor,
      spec,
      lastErrorAt: 0,
      testsFailing: false,
    });
    return id;
  }

  private addInitialMain(spec: DemoProjectSpec, projectIndex: number, mood: Mood, slot: number): void {
    const t0 = this.startedAt;
    const id = this.createMain(spec, projectIndex, t0, false, Number.POSITIVE_INFINITY);
    const runtime = this.runtimes.get(id) as Runtime;
    const sessionAge = randInt(runtime.rng, 5, 50) * 60_000;
    this.update(id, (agent) => ({
      ...agent,
      startedAt: t0 - sessionAge,
      stats: {
        ...agent.stats,
        toolCalls: randInt(runtime.rng, 12, 140),
        tokensIn: randInt(runtime.rng, 60_000, 900_000),
        tokensOut: randInt(runtime.rng, 8_000, 90_000),
        costUSD: randInt(runtime.rng, 30, 900) / 100,
        linesAdded: randInt(runtime.rng, 20, 800),
        linesRemoved: randInt(runtime.rng, 5, 200),
      },
    }));
    this.backfill(id, 5, t0 - 2000);
    const stepAt = t0 + 300 + slot * 350;
    if (mood === 'idle') {
      this.beginIdle(id, t0 - randInt(runtime.rng, 10, 60) * 1000, true);
      this.queue.push(t0 + this.dwell(runtime.rng, 6000, 20000), (at) => this.startTurn(id, at));
      return;
    }
    this.resumeTurn(id, t0);
    if (mood === 'shell') this.startLongShell(id, t0 - 180_000, 12 * 60_000);
    if (mood === 'subs') this.queue.push(t0 + 1200, (at) => this.spawnSubs(id, at, 2));
    if (mood === 'blocked') {
      this.queue.push(t0 + 500, (at) => this.blockOnPermission(id, at));
      return;
    }
    this.scheduleStep(id, stepAt);
  }

  /** Puts an agent in the middle of a turn without emitting feed items (used for the opening scene). */
  private resumeTurn(id: string, at: number): void {
    const runtime = this.runtimes.get(id) as Runtime;
    runtime.phase = 'working';
    runtime.turnStartedAt = at - randInt(runtime.rng, 20, 90) * 1000;
    runtime.stepsLeft = randInt(runtime.rng, 5, 9);
    runtime.stepsTotal = 12;
    this.update(id, (agent) => ({
      ...agent,
      tasks: this.planTasks(runtime, 0.45, at - randInt(runtime.rng, 5, 60) * 1000),
    }));
    this.setStatus(id, 'working', at - randInt(runtime.rng, 3, 25) * 1000);
  }

  private backfill(id: string, count: number, endAt: number): void {
    const runtime = this.runtimes.get(id) as Runtime;
    for (let i = count; i >= 1; i--) {
      this.emit(id, this.workDraft(runtime), endAt - i * randInt(runtime.rng, 2000, 5000), true);
    }
  }

  // ---- activities -------------------------------------------------------------------------------------------

  private emit(id: string, draft: ActivityDraft, at: number, quiet = false): void {
    const agent = this.agentMap.get(id);
    if (agent === undefined) return;
    const activity: Activity = toActivity(draft, this.nextId('demo-act'), at);
    const runtime = this.runtimes.get(id);
    const isTool =
      draft.kind !== 'prompt' && draft.kind !== 'done' && draft.kind !== 'message' && draft.kind !== 'permission';
    const tokensIn = isTool && runtime !== undefined ? randInt(runtime.rng, 2000, 18000) : 0;
    const tokensOut = isTool && runtime !== undefined ? randInt(runtime.rng, 150, 1800) : 0;
    const cost = tokensIn * 0.0000011 + tokensOut * 0.000015;
    this.agentMap.set(id, {
      ...agent,
      activity,
      recent: [...agent.recent, activity].slice(-RECENT_LIMIT),
      lastEventAt: at,
      stats: {
        ...agent.stats,
        toolCalls: agent.stats.toolCalls + (isTool ? 1 : 0),
        tokensIn: agent.stats.tokensIn + tokensIn,
        tokensOut: agent.stats.tokensOut + tokensOut,
        costUSD: (agent.stats.costUSD ?? 0) + cost,
        linesAdded:
          agent.stats.linesAdded +
          (draft.kind === 'edit' || draft.kind === 'write' ? randInt(runtime?.rng ?? this.rng, 2, 40) : 0),
        linesRemoved: agent.stats.linesRemoved + (draft.kind === 'edit' ? randInt(runtime?.rng ?? this.rng, 0, 12) : 0),
      },
    });
    if (quiet) return;
    this.pendingFeed.push({
      id: activity.id,
      agentId: id,
      agentName: agent.name,
      projectId: agent.projectId,
      activity,
    });
  }

  private notice(level: NoticeLevel, message: Msg, at: number, agentId?: string, projectId?: string): void {
    this.pendingNotices.push({
      id: this.nextId('demo-notice'),
      at,
      level,
      text: sourceText(message),
      msg: message,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    });
  }

  private noticeFor(id: string, level: NoticeLevel, message: Msg, at: number): void {
    this.notice(level, message, at, id, this.agentMap.get(id)?.projectId);
  }

  /** A believable tool call for the agent's project. */
  private workDraft(runtime: Runtime): ActivityDraft {
    const { rng, spec } = runtime;
    const roll = rng() * 100;
    if (roll < 14) return thinkingDraft();
    if (roll < 36) return describeToolUse('Read', { file_path: pick(rng, spec.files) });
    if (roll < 48) return describeToolUse('Grep', { pattern: pick(rng, DEMO_SEARCHES) });
    if (roll < 66) return describeToolUse('Edit', { file_path: pick(rng, spec.files) });
    if (roll < 72) return describeToolUse('Write', { file_path: pick(rng, spec.files) });
    if (roll < 86) {
      return commandDraft(pick(rng, DEMO_COMMANDS));
    }
    if (roll < 90) return describeToolUse('WebFetch', { url: pick(rng, DEMO_WEB).url });
    if (roll < 93) return describeToolUse(pick(rng, DEMO_MCP), {});
    if (roll < 96) return replyDraft();
    return describeToolUse('TodoWrite', {});
  }

  // ---- turns ------------------------------------------------------------------------------------------------

  /** A contiguous slice of the demo plan (so each turn reads like a different job), with `done` tasks already finished. */
  private planTasks(runtime: Runtime, progress: number, at: number): TaskItem[] {
    const count = randInt(runtime.rng, 3, MAX_DEMO_TASKS);
    const first = randInt(runtime.rng, 0, DEMO_TASK_PLAN.length - count);
    const done = Math.min(count - 1, Math.floor(progress * count));
    return DEMO_TASK_PLAN.slice(first, first + count).map((task, index): TaskItem => ({
      id: `t${index + 1}`,
      title: task.title.text,
      titleMsg: task.title.msg,
      activeForm: task.activeForm.text,
      activeFormMsg: task.activeForm.msg,
      status: demoTaskStatus(index, done),
      changedAt: at,
    }));
  }

  private progressTasks(id: string, runtime: Runtime, total: number, at: number): void {
    const fraction = total <= 0 ? 1 : 1 - runtime.stepsLeft / total;
    this.update(id, (agent) => {
      const count = agent.tasks.length;
      if (count === 0) return agent;
      const done = Math.min(count - 1, Math.floor(fraction * count));
      const tasks = agent.tasks.map((task, index): TaskItem => {
        const status = demoTaskStatus(index, done);
        return status === task.status ? task : { ...task, status, changedAt: at };
      });
      return { ...agent, tasks };
    });
  }

  private startTurn(id: string, at: number, prompt?: string): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined || runtime.phase !== 'idle') return;
    const source: DemoText | string = prompt ?? pick(runtime.rng, runtime.spec.prompts);
    runtime.phase = 'working';
    runtime.turnStartedAt = at;
    runtime.stepsLeft = randInt(runtime.rng, 8, 15);
    runtime.stepsTotal = runtime.stepsLeft;
    runtime.turnsLeft--;
    this.update(id, (agent) => ({ ...agent, ...titleOf(source), tasks: this.planTasks(runtime, 0, at) }));
    this.setStatus(id, 'working', at);
    this.emit(id, promptDraft(source), at);
    this.scheduleStep(id, at + this.dwell(runtime.rng, 900, 2200));
  }

  /** Schedules the next step of an agent, replacing any step chain that was already queued. */
  private scheduleStep(id: string, at: number): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined) return;
    const token = ++runtime.stepToken;
    this.queue.push(at, (when) => this.step(id, when, token));
  }

  private step(id: string, at: number, token: number): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined || runtime.phase !== 'working' || runtime.stepToken !== token) return;
    if (runtime.pendingSubs > 0) {
      this.scheduleStep(id, at + this.scale(800));
      return;
    }
    if (runtime.stepsLeft <= 0) {
      this.finishTurn(id, at);
      return;
    }
    runtime.stepsLeft--;
    this.progressTasks(id, runtime, runtime.stepsTotal, at);
    const roll = runtime.rng();
    const canBlock = this.blockedCount() < MAX_BLOCKED;
    if (roll < PERMISSION_CHANCE && canBlock) {
      this.blockOnPermission(id, at);
      return;
    }
    if (roll >= PERMISSION_CHANCE && roll < QUESTION_CHANCE && canBlock) {
      this.blockOnQuestion(id, at);
      return;
    }
    let delay = this.dwell(runtime.rng, 1200, 4500);
    if (roll < 0.11) {
      this.spawnSubs(id, at, randInt(runtime.rng, 1, 3));
      delay = this.dwell(runtime.rng, 800, 1500);
    } else if (roll < 0.28) {
      delay = Math.max(delay, this.runCommand(id, runtime, at));
    } else if (roll < 0.32 && (this.agentMap.get(id)?.shells.length ?? 0) === 0) {
      const shell = pick(runtime.rng, DEMO_LONG_SHELLS);
      this.emit(
        id,
        localizeDraft(
          describeToolUse('Bash', { command: shell.command, run_in_background: true }),
          msg('activity.bash.run', { text: shell.label.msg }),
        ),
        at,
      );
      this.startLongShell(id, at, randInt(runtime.rng, 60, 240) * 1000, shell);
    } else {
      this.emit(id, this.workDraft(runtime), at);
    }
    this.scheduleStep(id, at + delay);
  }

  private blockedCount(): number {
    return Array.from(this.runtimes.values()).filter((runtime) => runtime.phase === 'blocked').length;
  }

  /** Runs a shell command; slow ones show up as foreground shells. Returns how long the agent is busy. */
  private runCommand(id: string, runtime: Runtime, at: number): number {
    const command = this.pickCommand(runtime);
    this.emit(id, commandDraft(command), at);
    const duration = this.scale(command.durationMs);
    if (command.durationMs > 10_000) {
      const job: ShellJob = {
        id: this.nextId('demo-shell'),
        label: command.description.text,
        labelMsg: command.description.msg,
        command: command.command,
        background: false,
        kind: 'shell',
        startedAt: at,
      };
      this.update(id, (agent) => ({ ...agent, shells: [...agent.shells, job] }));
      this.queue.push(at + duration, () => this.removeShell(id, job.id));
    }
    const failure = this.commandFailure(runtime, command);
    if (failure !== null) this.queue.push(at + duration, (when) => this.fail(id, runtime, failure, when));
    return duration;
  }

  /** Tests and commits come up often enough that the office has something to celebrate within a couple of minutes. */
  private pickCommand(runtime: Runtime): DemoCommand {
    const roll = runtime.rng();
    const byCommand = (text: string): DemoCommand => DEMO_COMMANDS.find((c) => c.command === text) ?? DEMO_COMMANDS[0]!;
    if (roll < 0.46) return byCommand(DEMO_TEST_COMMAND);
    if (roll < 0.58) return byCommand(DEMO_COMMIT_COMMAND);
    const others = DEMO_COMMANDS.filter((c) => c.command !== DEMO_TEST_COMMAND && c.command !== DEMO_COMMIT_COMMAND);
    return pick(runtime.rng, others);
  }

  /** A test run fails once, then passes; commits always work; other commands now and then break. */
  private commandFailure(runtime: Runtime, command: DemoCommand): DemoError | null {
    if (command.command === DEMO_TEST_COMMAND) {
      if (runtime.testsFailing) {
        runtime.testsFailing = false;
        return null;
      }
      if (runtime.rng() >= 0.7) return null;
      runtime.testsFailing = true;
      return DEMO_ERRORS[0] as DemoError;
    }
    if (command.command === DEMO_COMMIT_COMMAND || runtime.rng() >= 0.14) return null;
    return pick(runtime.rng, DEMO_ERRORS.slice(1));
  }

  private fail(id: string, runtime: Runtime, failure: DemoError, at: number): void {
    if (runtime.phase === 'gone') return;
    this.emit(id, errorDraft(failure.tool, failure.detail, failure.message), at);
    if (at - runtime.lastErrorAt < this.scale(ERROR_NOTICE_GAP_MS)) return;
    runtime.lastErrorAt = at;
    this.noticeFor(id, 'warn', msg('notice.error', { name: this.nameOf(id), tool: failure.tool }), at);
  }

  private removeShell(id: string, shellId: string): void {
    this.update(id, (agent) => ({ ...agent, shells: agent.shells.filter((shell) => shell.id !== shellId) }));
  }

  private startLongShell(
    id: string,
    startedAt: number,
    durationMs: number,
    preset = pick(this.rng, DEMO_LONG_SHELLS),
  ): void {
    const job: ShellJob = {
      id: this.nextId('demo-shell'),
      label: preset.label.text,
      labelMsg: preset.label.msg,
      command: preset.command,
      background: true,
      kind: 'shell',
      startedAt,
    };
    this.update(id, (agent) => ({ ...agent, shells: [...agent.shells, job] }));
    this.queue.push(startedAt + this.scale(durationMs), () => this.removeShell(id, job.id));
  }

  private finishTurn(id: string, at: number): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined || runtime.phase === 'gone') return;
    const duration = at - runtime.turnStartedAt;
    this.emit(id, doneDraft(duration), at);
    this.update(id, (agent) => ({
      ...agent,
      tasks: agent.tasks.map((task): TaskItem =>
        task.status === 'completed' ? task : { ...task, status: 'completed', changedAt: at },
      ),
      shells: agent.shells.filter((shell) => shell.background),
    }));
    this.noticeFor(id, 'success', msg('notice.done', { name: this.nameOf(id), duration: durationMsg(duration) }), at);
    this.beginIdle(id, at);
    if (runtime.turnsLeft <= 0) {
      this.queue.push(at + this.dwell(runtime.rng, 4000, 9000), (when) => this.leave(id, when));
      return;
    }
    this.queue.push(at + this.dwell(runtime.rng, 8000, 25000), (when) => this.startTurn(id, when));
  }

  private beginIdle(id: string, at: number, quiet = false): void {
    const runtime = this.runtimes.get(id) as Runtime;
    runtime.phase = 'idle';
    this.setStatus(id, 'idle', at);
    if (quiet) this.emit(id, doneDraft(randInt(runtime.rng, 20, 240) * 1000), at, true);
  }

  // ---- waiting ----------------------------------------------------------------------------------------------

  private blockOnPermission(id: string, at: number): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined || runtime.phase === 'gone') return;
    const spec = DEMO_PERMISSIONS[this.permissionCursor++ % DEMO_PERMISSIONS.length] as DemoPermissionSpec;
    const request: PermissionRequest = {
      id: this.nextId('demo-perm'),
      agentId: id,
      toolName: spec.toolName,
      summary: spec.summary,
      ...(spec.summaryMsg !== undefined ? { summaryMsg: spec.summaryMsg } : {}),
      input: spec.input,
      suggestions: spec.suggestions.map((suggestion) => suggestion.text),
      suggestionMsgs: spec.suggestions.map((suggestion) => suggestion.msg),
      createdAt: at,
      expiresAt: at + this.scale(PERMISSION_TIMEOUT_MS),
    };
    runtime.phase = 'blocked';
    const episode = ++runtime.episode;
    const automatic = this.autoDecide?.(request, this.agentMap.get(id) as Agent);
    if (automatic !== undefined && automatic.behavior !== 'terminal') {
      this.emit(id, ruleDraft(automatic.behavior, spec.summary, spec.summaryMsg), at);
      this.resolveBlock(id, episode, automatic, at);
      return;
    }
    this.setStatus(id, 'waiting', at, { permission: request, waitingFor: undefined, waitingForMsg: undefined });
    this.emit(id, permissionDraft(spec.summary, spec.summaryMsg), at);
    this.noticeFor(
      id,
      'alert',
      msg('notice.needs.detail', { name: this.nameOf(id), detail: spec.summaryMsg ?? spec.summary }),
      at,
    );
    this.queue.push(request.expiresAt, (when) => this.resolveBlock(id, episode, { behavior: 'terminal' }, when));
  }

  private blockOnQuestion(id: string, at: number): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined || runtime.phase === 'gone') return;
    runtime.phase = 'blocked';
    const episode = ++runtime.episode;
    this.setStatus(id, 'waiting', at, {
      waitingFor: DEMO_QUESTION.text,
      waitingForMsg: DEMO_QUESTION.msg,
      permission: undefined,
    });
    this.emit(id, describeToolUse('AskUserQuestion', {}), at);
    this.noticeFor(id, 'alert', msg('notice.question', { name: this.nameOf(id) }), at);
    this.queue.push(at + this.dwell(runtime.rng, 18000, 40000), (when) =>
      this.resolveBlock(id, episode, { behavior: 'terminal' }, when),
    );
  }

  private resolveBlock(id: string, episode: number, decision: PermissionDecision, at: number): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined || runtime.phase !== 'blocked' || runtime.episode !== episode) return;
    runtime.phase = 'working';
    runtime.episode++;
    this.setStatus(id, 'working', at, { permission: undefined, waitingFor: undefined, waitingForMsg: undefined });
    if (decision.behavior === 'deny' && decision.auto !== 'rule') {
      const denied = msg('activity.denied');
      this.emit(id, { kind: 'other', icon: '🚫', text: sourceText(denied), msg: denied, detail: decision.message }, at);
      if (decision.interrupt === true) {
        this.finishTurn(id, at);
        return;
      }
    }
    this.scheduleStep(id, at + this.dwell(runtime.rng, 700, 1600));
  }

  // ---- subagents --------------------------------------------------------------------------------------------

  private spawnSubs(parentId: string, at: number, count: number): void {
    const parent = this.agentMap.get(parentId);
    const runtime = this.runtimes.get(parentId);
    if (parent === undefined || runtime === undefined || runtime.phase === 'gone') return;
    for (let i = 0; i < count; i++) {
      const spec = pick(runtime.rng, DEMO_SUBAGENTS);
      const delegated = localizeDraft(
        describeToolUse('Agent', { description: spec.description.text, subagent_type: spec.type }),
        msg('activity.subagent', { description: spec.description.msg }),
      );
      this.emit(parentId, delegated, at + i * 80);
      this.update(parentId, (agent) => ({ ...agent, stats: { ...agent.stats, subagents: agent.stats.subagents + 1 } }));
      runtime.pendingSubs++;
      this.createSub(parent, runtime, spec, at + i * 80);
    }
  }

  private createSub(
    parent: Agent,
    parentRuntime: Runtime,
    spec: { type: string; description: DemoText },
    at: number,
  ): void {
    const id = this.nextId('demo');
    const person = pickName(`${this.seed}:${id}`, this.takenNames());
    const rng = mulberry32(fnv1a(`${this.seed}:${id}`));
    this.agentMap.set(id, {
      id,
      kind: 'sub',
      sessionId: parent.sessionId,
      accountId: parent.accountId,
      projectId: parent.projectId,
      parentId: parent.id,
      name: person.name,
      role: spec.type,
      ...titleOf(spec.description),
      look: person.look,
      seed: fnv1a(id),
      status: 'working',
      statusSince: at,
      recent: [],
      tasks: [],
      shells: [],
      stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, costUSD: 0, linesAdded: 0, linesRemoved: 0, subagents: 0 },
      model: parent.model,
      startedAt: at,
      lastEventAt: at,
      demo: true,
    });
    this.runtimes.set(id, {
      ...parentRuntime,
      rng,
      phase: 'working',
      stepToken: 0,
      stepsLeft: randInt(rng, 3, 7),
      pendingSubs: 0,
      turnsLeft: 0,
      visitor: false,
    });
    this.queue.push(at + this.dwell(rng, 900, 1800), (when) => this.subStep(id, parent.id, when));
  }

  private subStep(id: string, parentId: string, at: number): void {
    const runtime = this.runtimes.get(id);
    if (runtime === undefined || runtime.phase !== 'working') return;
    if (runtime.stepsLeft <= 0) {
      this.finishSub(id, parentId, runtime, at);
      return;
    }
    runtime.stepsLeft--;
    this.emit(id, this.workDraft(runtime), at);
    this.queue.push(at + this.dwell(runtime.rng, 1500, 3200), (when) => this.subStep(id, parentId, when));
  }

  private finishSub(id: string, parentId: string, runtime: Runtime, at: number): void {
    const startedAt = this.agentMap.get(id)?.startedAt ?? at;
    runtime.phase = 'gone';
    this.emit(id, doneDraft(at - startedAt), at);
    this.setStatus(id, 'done', at);
    const parentRuntime = this.runtimes.get(parentId);
    if (parentRuntime !== undefined) parentRuntime.pendingSubs = Math.max(0, parentRuntime.pendingSubs - 1);
    this.queue.push(at + this.scale(SUB_LINGER_MS), () => this.remove(id));
  }

  // ---- arrivals and departures ------------------------------------------------------------------------------

  private remove(id: string): void {
    const agent = this.agentMap.get(id);
    if (agent === undefined) return;
    this.agentMap.delete(id);
    this.runtimes.delete(id);
    this.releaseProjectIfEmpty(agent.projectId);
  }

  private leave(id: string, at: number): void {
    const runtime = this.runtimes.get(id);
    const agent = this.agentMap.get(id);
    if (runtime === undefined || agent === undefined || runtime.phase === 'gone') return;
    runtime.phase = 'gone';
    this.setStatus(id, 'offline', at, { permission: undefined, waitingFor: undefined, waitingForMsg: undefined });
    this.noticeFor(id, 'info', msg('notice.left.in', { name: agent.name, project: runtime.spec.name }), at);
    for (const other of this.agentMap.values()) {
      if (other.parentId === id) this.queue.push(at + this.scale(SUB_LINGER_MS), () => this.remove(other.id));
    }
    this.queue.push(at + this.scale(LEAVE_LINGER_MS), () => this.remove(id));
  }

  private scheduleChurn(from: number): void {
    this.queue.push(from + this.dwell(this.rng, CHURN_MIN_MS, CHURN_MAX_MS), (at) => {
      this.spawnVisitor(at);
      this.scheduleChurn(at);
    });
  }

  private spawnVisitor(at: number): void {
    const visitors = Array.from(this.runtimes.values()).filter(
      (runtime) => runtime.visitor && runtime.phase !== 'gone',
    ).length;
    if (visitors >= MAX_VISITORS) return;
    const index = Math.floor(this.rng() * Math.min(DEMO_PROJECTS.length, MAX_PROJECTS));
    const spec = DEMO_PROJECTS[index] as DemoProjectSpec;
    const id = this.createMain(spec, index, at, true, randInt(this.rng, 1, 2));
    this.noticeFor(id, 'info', msg('notice.opened', { name: this.nameOf(id), project: spec.name }), at);
    this.queue.push(at + this.scale(1500), (when) => this.startTurn(id, when));
  }

  // ---- messages ---------------------------------------------------------------------------------------------

  private storeMessage(message: BossMessage): void {
    const list = [...(this.messageMap.get(message.agentId) ?? []), message].slice(-MESSAGE_LIMIT);
    this.messageMap.set(message.agentId, list);
  }

  private deliverMessage(messageId: string, agentId: string, at: number): void {
    const list = this.messageMap.get(agentId);
    const message = list?.find((candidate) => candidate.id === messageId);
    if (list === undefined || message === undefined) return;
    this.messageMap.set(
      agentId,
      list.map((candidate) =>
        candidate.id === messageId
          ? { ...candidate, status: 'delivered' as const, deliveredAt: at, via: 'demo' as const }
          : candidate,
      ),
    );
    const runtime = this.runtimes.get(agentId);
    if (runtime === undefined || runtime.phase === 'gone') return;
    this.emit(agentId, messageDraft(message.text), at);
    if (runtime.phase === 'idle')
      this.queue.push(at + this.scale(1500), (when) => this.startTurn(agentId, when, message.text));
  }

  // ---- usage ------------------------------------------------------------------------------------------------

  private usageAnchors(): DemoSessionAnchor[] {
    return Array.from(this.agentMap.values())
      .filter((agent) => agent.kind === 'main')
      .map((agent) => ({ account: agent.accountId, session: agent.sessionId, project: agent.projectId }));
  }

  usageRows(now: number): UsageRow[] {
    return demoUsageRows(now, this.usageAnchors());
  }

  private usage(now: number): AccountUsage[] {
    return demoAccountUsage(now, this.usageRows(now));
  }
}

/** Creates a demo simulator. Same seed + same sequence of `tick` times = same story. */
export function createDemoSimulator(opts: DemoOptions = {}): DemoSimulator {
  return new Simulator(opts);
}
