// Keeps the git state of every room fresh without ever being a burden: reads are read-only, run at most two at a time,
// each with a time limit, and are scheduled by how much the room matters (30 s with working agents, 5 min otherwise,
// and soon after the agents touched files). Pull requests (through `gh`) are asked every 2 minutes, only when enabled.
import type { GhStatus, GitPullRequest, ProjectGit } from '@ai-office/shared';
import type { Logger } from '../log';
import { lookupPullRequest } from './pull-request';
import { findGitDir, readGitState } from './read-state';
import { RunError, type Runner } from './run';

export const ACTIVE_REFRESH_MS = 30_000;
export const IDLE_REFRESH_MS = 5 * 60_000;
export const PR_REFRESH_MS = 2 * 60_000;
/** A touch waits this long for more touches, but never longer than TOUCH_MAX_WAIT_MS. */
export const TOUCH_DEBOUNCE_MS = 2000;
export const TOUCH_MAX_WAIT_MS = 10_000;
export const MAX_CONCURRENT_READS = 2;
/** After the program is missing (git) or not signed in (gh), try again only this much later. */
export const UNAVAILABLE_RETRY_MS = 10 * 60_000;
/** Failed reads in a row before the last known state is dropped. */
const MAX_FAILURES = 3;

export interface WatchedProject {
  id: string;
  path: string;
  /** Has agents working or waiting: refreshed more often. */
  active: boolean;
}

export interface GitWatcherDeps {
  runGit: Runner;
  runGh: Runner;
  now: () => number;
  log: Logger;
  /** The real rooms right now (the demo's are not read). */
  projects: () => WatchedProject[];
  pullRequestsEnabled: () => boolean;
  /** The visible state of at least one room changed. */
  onChange: () => void;
  /** Whether the folder is a repository (default: it has a `.git`). */
  hasRepository?: (path: string) => Promise<boolean>;
}

interface Entry {
  path: string;
  active: boolean;
  git: ProjectGit | undefined;
  /** Pull request found for `prBranch`. */
  pr: GitPullRequest | undefined;
  prBranch: string | undefined;
  readAt: number;
  prAt: number;
  touchFirst: number | undefined;
  touchLast: number | undefined;
  failures: number;
  queued: Set<Job['kind']>;
}

interface Job {
  kind: 'git' | 'pr';
  id: string;
}

const defaultHasRepository = async (path: string): Promise<boolean> => (await findGitDir(path)) !== undefined;

export class GitWatcher {
  private readonly entries = new Map<string, Entry>();
  private readonly queue: Job[] = [];
  private readonly hasRepository: (path: string) => Promise<boolean>;
  private running = 0;
  private stopped = false;
  private gitBlockedUntil = 0;
  private ghBlockedUntil = 0;
  private gh: GhStatus = 'unknown';
  private wasEnabled = false;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly deps: GitWatcherDeps) {
    this.hasRepository = deps.hasRepository ?? defaultHasRepository;
  }

  /** The state of a room: git, plus its pull request while they are enabled and belong to the current branch. */
  get(projectId: string): ProjectGit | undefined {
    const entry = this.entries.get(projectId);
    if (entry?.git === undefined) return undefined;
    const { pr } = entry;
    if (pr === undefined || !this.deps.pullRequestsEnabled() || entry.git.branch !== entry.prBranch) return entry.git;
    return { ...entry.git, pr };
  }

  ghStatus(): GhStatus {
    return this.gh;
  }

  /** The agents of a room did something that may have changed files: read it again soon. */
  touch(projectId: string): void {
    const entry = this.entries.get(projectId);
    if (entry === undefined) return;
    const now = this.deps.now();
    entry.touchFirst ??= now;
    entry.touchLast = now;
  }

  /** Call about once a second: follows the rooms and starts the reads that are due. */
  tick(): void {
    if (this.stopped) return;
    const now = this.deps.now();
    this.followProjects();
    this.followPullRequestSetting();
    for (const [id, entry] of this.entries) {
      if (this.gitDue(entry, now)) this.enqueue('git', id, entry);
      if (this.pullRequestDue(entry, now)) this.enqueue('pr', id, entry);
    }
    this.pump();
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
  }

  /** Resolves when nothing is queued or running (tests). */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---- scheduling ---------------------------------------------------------------------------------------------

  private followProjects(): void {
    const wanted = new Map(this.deps.projects().map((project) => [project.id, project]));
    let removed = false;
    for (const id of [...this.entries.keys()]) {
      if (wanted.has(id)) continue;
      removed = removed || this.entries.get(id)?.git !== undefined;
      this.entries.delete(id);
    }
    for (const project of wanted.values()) {
      const entry = this.entries.get(project.id);
      if (entry === undefined) {
        this.entries.set(project.id, {
          path: project.path,
          active: project.active,
          git: undefined,
          pr: undefined,
          prBranch: undefined,
          readAt: 0,
          prAt: 0,
          touchFirst: undefined,
          touchLast: undefined,
          failures: 0,
          queued: new Set(),
        });
      } else {
        entry.active = project.active;
        entry.path = project.path;
      }
    }
    if (removed) this.deps.onChange();
  }

  /** Turning pull requests on starts from scratch (and forgets that `gh` was missing); turning them off hides them. */
  private followPullRequestSetting(): void {
    const enabled = this.deps.pullRequestsEnabled();
    if (enabled === this.wasEnabled) return;
    this.wasEnabled = enabled;
    this.ghBlockedUntil = 0;
    if (enabled) this.gh = 'unknown';
    for (const entry of this.entries.values()) entry.prAt = 0;
    this.deps.onChange();
  }

  private gitDue(entry: Entry, now: number): boolean {
    if (now < this.gitBlockedUntil || entry.queued.has('git')) return false;
    if (entry.readAt === 0) return true;
    if (entry.touchLast !== undefined && entry.touchFirst !== undefined && (now - entry.touchLast >= TOUCH_DEBOUNCE_MS || now - entry.touchFirst >= TOUCH_MAX_WAIT_MS)) return true;
    return now - entry.readAt >= (entry.active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS);
  }

  private pullRequestDue(entry: Entry, now: number): boolean {
    if (!this.deps.pullRequestsEnabled() || now < this.ghBlockedUntil || entry.queued.has('pr')) return false;
    const branch = entry.git?.branch;
    if (branch === undefined) return false;
    return branch !== entry.prBranch || now - entry.prAt >= PR_REFRESH_MS;
  }

  private enqueue(kind: Job['kind'], id: string, entry: Entry): void {
    entry.queued.add(kind);
    this.queue.push({ kind, id });
  }

  private pump(): void {
    while (!this.stopped && this.running < MAX_CONCURRENT_READS) {
      const job = this.queue.shift();
      if (job === undefined) break;
      this.running++;
      void this.execute(job).finally(() => {
        this.running--;
        this.pump();
        this.notifyIdle();
      });
    }
    this.notifyIdle();
  }

  private notifyIdle(): void {
    if (this.running > 0 || this.queue.length > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  // ---- work ---------------------------------------------------------------------------------------------------

  private async execute(job: Job): Promise<void> {
    const entry = this.entries.get(job.id);
    if (entry === undefined) return;
    try {
      if (job.kind === 'git') await this.readGit(job.id, entry);
      else await this.readPullRequest(job.id, entry);
    } catch (error) {
      this.deps.log.debug(`Git (${job.kind}) em ${job.id}: ${String(error)}`);
    } finally {
      entry.queued.delete(job.kind);
    }
  }

  private async readGit(id: string, entry: Entry): Promise<void> {
    const startedAt = this.deps.now();
    entry.readAt = startedAt;
    const before = JSON.stringify(entry.git);
    if (!(await this.hasRepository(entry.path))) {
      entry.git = undefined;
      entry.failures = 0;
    } else {
      try {
        entry.git = await readGitState(this.deps.runGit, entry.path);
        entry.failures = 0;
      } catch (error) {
        this.onGitFailure(entry, error);
      }
    }
    if (entry.touchLast !== undefined && entry.touchLast <= startedAt) {
      entry.touchFirst = undefined;
      entry.touchLast = undefined;
    }
    if (this.entries.get(id) === entry && JSON.stringify(entry.git) !== before) this.deps.onChange();
  }

  private onGitFailure(entry: Entry, error: unknown): void {
    if (error instanceof RunError && error.notFound) {
      this.gitBlockedUntil = this.deps.now() + UNAVAILABLE_RETRY_MS;
      for (const other of this.entries.values()) other.git = undefined;
      this.deps.log.debug('O comando git não foi encontrado; o estado do Git fica desligado por alguns minutos.');
      return;
    }
    entry.failures++;
    if (entry.failures >= MAX_FAILURES) entry.git = undefined;
  }

  private async readPullRequest(id: string, entry: Entry): Promise<void> {
    const branch = entry.git?.branch;
    if (branch === undefined) return;
    entry.prAt = this.deps.now();
    const before = JSON.stringify(this.get(id)?.pr);
    const result = await lookupPullRequest(this.deps.runGh, entry.path);
    // A failed lookup keeps the last pull request of the same branch (a flaky network must not blink the light).
    if (result.status === 'error' && entry.prBranch !== branch) entry.pr = undefined;
    if (result.status === 'unavailable') {
      this.gh = result.gh;
      this.ghBlockedUntil = this.deps.now() + UNAVAILABLE_RETRY_MS;
      entry.pr = undefined;
    } else if (result.status === 'found' || result.status === 'none') {
      this.gh = 'ready';
      entry.pr = result.status === 'found' ? result.pr : undefined;
    }
    entry.prBranch = branch;
    if (this.entries.get(id) === entry && JSON.stringify(this.get(id)?.pr) !== before) this.deps.onChange();
  }
}
