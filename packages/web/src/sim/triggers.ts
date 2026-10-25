// Celebration triggers: pure detection over consecutive snapshots. The tracker remembers just enough about the previous
// snapshot (statuses, task lists, activity ids, repository heads) to tell what changed; it never touches the clock.
import type { Activity, Agent, OfficeSnapshot, TaskItem } from '@ai-office/shared';

export type TriggerKind = 'tests-fixed' | 'tasks-done' | 'commit' | 'pr-merged' | 'subagent-done' | 'streak-end';

export interface Trigger {
  kind: TriggerKind;
  /** The person who celebrates. */
  agentId: string;
  projectId: string;
}

/** A work turn at least this long (ms) makes its end worth a party. Demo turns are short, so they get a lower bar. */
export const STREAK_MS = 4 * 60_000;
export const DEMO_STREAK_MS = 25_000;

const TEST_COMMAND =
  /(?:^|[\s;&|(])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?|npx\s+(?:vitest|jest|mocha|playwright\s+test)|vitest|jest|mocha|pytest|phpunit|rspec|go\s+test|cargo\s+(?:test|nextest)|dotnet\s+test|mvn\s+(?:\S+\s+)*test|gradlew?\s+test|node\s+--test|deno\s+test|swift\s+test|make\s+test)(?=$|[\s;&|)])/;
const COMMIT_COMMAND = /(?:^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?commit(?=$|\s)/;

export function isTestCommand(command: string | undefined): boolean {
  return command !== undefined && TEST_COMMAND.test(command);
}

export function isCommitCommand(command: string | undefined): boolean {
  return command !== undefined && COMMIT_COMMAND.test(command) && !/--dry-run/.test(command);
}

/** The tool whose failure an `error` activity reports (its `tool` message parameter), when known. */
function errorTool(activity: Activity): string | undefined {
  const tool = activity.msg?.params?.tool;
  return typeof tool === 'string' ? tool : undefined;
}

function isError(activity: Activity): boolean {
  return activity.error === true || activity.kind === 'error';
}

/** What a shell command was run for, which decides the celebration its success earns. */
type Probe = 'tests' | 'commit';

interface AgentMemory {
  status: Agent['status'];
  statusSince: number;
  tasksDone: boolean;
  seen: Set<string>;
  /** A test or commit command whose result is not known yet: the next activity tells (an error means it failed). */
  pending: { probe: Probe } | null;
  /** The last test run failed: the next passing one is a fix. */
  testsFailing: boolean;
}

interface ProjectMemory {
  commit: string | undefined;
  prMerged: boolean;
}

const SEEN_LIMIT = 60;

function allTasksDone(tasks: readonly TaskItem[]): boolean {
  return tasks.length > 0 && tasks.every((t) => t.status === 'completed');
}

function remember(seen: Set<string>, id: string): void {
  seen.add(id);
  if (seen.size > SEEN_LIMIT) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

/** Picks who celebrates a repository event in a project: the person working the most recently, a main agent first. */
function projectCelebrant(agents: readonly Agent[], projectId: string, hint: (a: Agent) => number): Agent | undefined {
  const inRoom = agents.filter((a) => a.projectId === projectId && a.status !== 'done' && a.status !== 'offline');
  const mains = inRoom.filter((a) => a.kind === 'main');
  const pool = mains.length > 0 ? mains : inRoom;
  return [...pool].sort((p, q) => hint(q) - hint(p) || (p.id < q.id ? -1 : 1))[0];
}

export class TriggerTracker {
  private agents = new Map<string, AgentMemory>();
  private projects = new Map<string, ProjectMemory>();
  private primed = false;

  /** Forget everything: the next snapshot only primes the memory (a replay jump must not set off a party). */
  reset(): void {
    this.agents = new Map();
    this.projects = new Map();
    this.primed = false;
  }

  /** Compares the snapshot with the previous one and returns what is worth celebrating. */
  update(snapshot: OfficeSnapshot): Trigger[] {
    const triggers: Trigger[] = [];
    const live = this.primed;
    const streakMs = snapshot.meta.demo ? DEMO_STREAK_MS : STREAK_MS;
    for (const agent of snapshot.agents) {
      const memory = this.agents.get(agent.id);
      if (memory === undefined) {
        this.agents.set(agent.id, this.prime(agent));
        continue;
      }
      if (live) this.compare(memory, agent, streakMs, triggers);
      this.store(memory, agent);
    }
    for (const id of [...this.agents.keys()]) {
      if (!snapshot.agents.some((a) => a.id === id)) this.agents.delete(id);
    }
    this.watchProjects(snapshot, live, triggers);
    this.primed = true;
    return triggers;
  }

  private prime(agent: Agent): AgentMemory {
    return {
      status: agent.status,
      statusSince: agent.statusSince,
      tasksDone: allTasksDone(agent.tasks),
      seen: new Set(agent.recent.map((a) => a.id)),
      pending: null,
      testsFailing: false,
    };
  }

  private store(memory: AgentMemory, agent: Agent): void {
    memory.status = agent.status;
    memory.statusSince = agent.statusSince;
    memory.tasksDone = allTasksDone(agent.tasks);
  }

  private compare(memory: AgentMemory, agent: Agent, streakMs: number, out: Trigger[]): void {
    const at = (kind: TriggerKind): void => void out.push({ kind, agentId: agent.id, projectId: agent.projectId });
    const fresh = agent.recent.filter((a) => !memory.seen.has(a.id));
    for (const activity of fresh) {
      remember(memory.seen, activity.id);
      this.read(memory, activity, at);
    }
    const leftWork = memory.status === 'working' && agent.status !== 'working' && agent.status !== 'waiting';
    if (leftWork) this.settle(memory, at);
    if (!memory.tasksDone && allTasksDone(agent.tasks)) at('tasks-done');
    if (agent.kind === 'sub' && memory.status === 'working' && agent.status === 'done' && !this.endedBadly(agent))
      at('subagent-done');
    if (agent.kind === 'main' && memory.status === 'working' && agent.status === 'idle') {
      if (memory.statusSince > 0 && agent.statusSince - memory.statusSince >= streakMs) at('streak-end');
    }
  }

  private endedBadly(agent: Agent): boolean {
    const last = agent.recent[agent.recent.length - 1];
    return last !== undefined && isError(last);
  }

  /** One new activity: it settles the command waiting for its result, and may start a new wait. */
  private read(memory: AgentMemory, activity: Activity, at: (kind: TriggerKind) => void): void {
    if (isError(activity)) {
      const tool = errorTool(activity);
      if (memory.pending !== null && (tool === undefined || tool === 'Bash')) {
        if (memory.pending.probe === 'tests') memory.testsFailing = true;
        memory.pending = null;
      }
      return;
    }
    this.settle(memory, at);
    if (activity.kind !== 'bash') return;
    if (isTestCommand(activity.detail)) memory.pending = { probe: 'tests' };
    else if (isCommitCommand(activity.detail)) memory.pending = { probe: 'commit' };
  }

  /** The pending command got no error: it passed. */
  private settle(memory: AgentMemory, at: (kind: TriggerKind) => void): void {
    const pending = memory.pending;
    if (pending === null) return;
    memory.pending = null;
    if (pending.probe === 'commit') return at('commit');
    if (memory.testsFailing) {
      memory.testsFailing = false;
      at('tests-fixed');
    }
  }

  private watchProjects(snapshot: OfficeSnapshot, live: boolean, out: Trigger[]): void {
    const lastActivity = (a: Agent): number => a.activity?.at ?? a.lastEventAt;
    for (const project of snapshot.projects) {
      const git = project.git;
      const memory = this.projects.get(project.id);
      const next: ProjectMemory = { commit: git?.lastCommit?.hash, prMerged: git?.pr?.state === 'merged' };
      this.projects.set(project.id, next);
      if (!live || memory === undefined) continue;
      const celebrant = projectCelebrant(snapshot.agents, project.id, lastActivity);
      if (celebrant === undefined) continue;
      if (next.prMerged && !memory.prMerged)
        out.push({ kind: 'pr-merged', agentId: celebrant.id, projectId: project.id });
      else if (next.commit !== undefined && memory.commit !== undefined && next.commit !== memory.commit)
        out.push({ kind: 'commit', agentId: celebrant.id, projectId: project.id });
    }
    for (const id of [...this.projects.keys()]) {
      if (!snapshot.projects.some((p) => p.id === id)) this.projects.delete(id);
    }
  }
}

/** All the tasks of everybody in a room are done (and there are enough of them to be a milestone). */
export function roomMilestone(agents: readonly Agent[], projectId: string): boolean {
  const tasks = agents.filter((a) => a.projectId === projectId).flatMap((a) => a.tasks);
  return tasks.length >= 3 && tasks.every((t) => t.status === 'completed');
}
