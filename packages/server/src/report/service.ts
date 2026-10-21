// The day report service: finds the transcripts that were written during the day, reads the day's slice of each one
// (cached, resumable, off the event loop, one scan at a time), and joins the result with the usage index, the names of
// the people and the status times the office recorded.
import { readFile } from 'node:fs/promises';
import {
  type Account,
  type Agent,
  type DayRange,
  type DayReport,
  type DayStats,
  type PersonName,
  type ReportCommit,
  type ReportUsage,
  type Timelapse,
  floorToHour,
  findPerson,
  pickName,
  rowTokens,
} from '@ai-office/shared';
import { parseSubagentMeta, type SubagentMeta } from '../claude/paths';
import type { Logger } from '../log';
import { type SessionTrace, buildTimelapse } from '../timelapse/build';
import { asRecord } from '../util/fs-safe';
import type { UsageIndexer } from '../usage/indexer';
import { type TranscriptFile, discoverTranscripts } from '../usage/discover';
import type { FileDay } from './accumulator';
import { buildDayReport } from './build';
import { type ReadBudget, type ReadState, readFileDay } from './reader';

export const MAX_FILES = 600;
export const MAX_BYTES_PER_FILE = 256 * 1024 * 1024;
export const SCAN_TIMEOUT_MS = 25_000;
const MAX_CACHED_FILES = 1200;
const MAX_GIT_PROJECTS = 20;

export interface ReportLimits {
  maxFiles: number;
  maxBytesPerFile: number;
  timeoutMs: number;
}

export interface ReportDeps {
  now: () => number;
  log: Logger;
  usage: Pick<UsageIndexer, 'rows' | 'progress'>;
  /** The status times the office recorded for a date. */
  dayStats: (date: string) => Promise<DayStats>;
  /** Agents the office knows now (their names are the ones the user sees). */
  agents: () => readonly Agent[];
  /** A name stored for a session of an earlier day, if any. */
  storedName: (key: string) => string | undefined;
  /** Commits of the Git integration for a project folder on a day; leave out when there is none. */
  gitCommits?: (projectPath: string, range: DayRange) => Promise<readonly ReportCommit[]>;
  limits?: Partial<ReportLimits>;
}

export interface ReportRequest {
  range: DayRange;
  accounts: readonly Account[];
  /** The value reported as `account`: an id or "all". */
  label: string;
  includeRequests: boolean;
}

export interface TimelapseRequest {
  range: DayRange;
  accounts: readonly Account[];
  label: string;
}

/** Subagent meta files read so far (they never change once written). */
const MAX_CACHED_META = 2000;

interface ScannedFile {
  file: TranscriptFile;
  state: ReadState;
}

const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export class ReportService {
  private readonly cache = new Map<string, ReadState>();
  private readonly metas = new Map<string, SubagentMeta>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly limits: ReportLimits;

  constructor(private readonly deps: ReportDeps) {
    this.limits = {
      maxFiles: MAX_FILES,
      maxBytesPerFile: MAX_BYTES_PER_FILE,
      timeoutMs: SCAN_TIMEOUT_MS,
      ...deps.limits,
    };
  }

  /** The report of a day. Concurrent requests for the same report share one scan; scans run one at a time. */
  report(request: ReportRequest): Promise<DayReport> {
    return this.enqueue(`report|${request.range.date}|${request.label}|${request.includeRequests}`, () =>
      this.scan(request),
    );
  }

  /** The time-lapse of a day. It shares the report's reader, its cache and its queue. */
  timelapse(request: TimelapseRequest): Promise<Timelapse> {
    return this.enqueue(`timelapse|${request.range.date}|${request.label}`, () => this.scanTimelapse(request));
  }

  private enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key);
    if (running !== undefined) return running as Promise<T>;
    const started = this.queue.then(job);
    this.queue = started.catch(() => undefined);
    const tracked = started.finally(() => this.inflight.delete(key));
    this.inflight.set(key, tracked);
    return tracked;
  }

  /** Reads the day's slice of every transcript written that day, within the file, byte and time limits. */
  private async readDay(
    request: { range: DayRange; accounts: readonly Account[] },
    trace: boolean,
  ): Promise<{ files: ScannedFile[]; truncated: boolean }> {
    const started = this.deps.now();
    const budget: ReadBudget = {
      maxBytes: this.limits.maxBytesPerFile,
      deadline: started + this.limits.timeoutMs,
      now: this.deps.now,
      yieldTurn: turn,
    };
    const candidates = await this.candidates(request);
    let truncated = candidates.length > this.limits.maxFiles;
    const files: ScannedFile[] = [];
    for (const file of candidates.slice(0, this.limits.maxFiles)) {
      if (this.deps.now() >= budget.deadline) {
        truncated = true;
        break;
      }
      const state = await this.read(file, request.range, budget, trace);
      if (state === undefined) continue;
      if (state.truncated) truncated = true;
      files.push({ file, state });
    }
    return { files, truncated };
  }

  private async scan(request: ReportRequest): Promise<DayReport> {
    const { files, truncated } = await this.readDay(request, false);
    const sessions = new Map<string, { accountId: string; sessionId: string; files: FileDay[] }>();
    for (const { file, state } of files) {
      const key = `${file.account}:${file.session}`;
      const session = sessions.get(key) ?? { accountId: file.account, sessionId: file.session, files: [] };
      session.files.push(state.acc.result());
      sessions.set(key, session);
    }
    const usage = this.usageByKey(request.range);
    const status = await this.statusByAgent(request.range.date);
    const names = this.nameLookup();
    const report = buildDayReport({
      date: request.range.date,
      now: this.deps.now(),
      account: request.label,
      includeRequests: request.includeRequests,
      sessions: [...sessions.values()],
      nameOf: names,
      usageOf: (accountId, sessionId) => usage.get(`${accountId}:${sessionId}`) ?? { tokens: 0, costUSD: 0 },
      statusOf: (agentId) => status.get(agentId),
      truncated,
      usageIndexing: this.deps.usage.progress().state === 'indexing',
    });
    return this.withGitCommits(report, request.range);
  }

  private async scanTimelapse(request: TimelapseRequest): Promise<Timelapse> {
    const { files, truncated } = await this.readDay(request, true);
    const sessions = new Map<
      string,
      { accountId: string; sessionId: string; files: SessionTrace['files'][number][] }
    >();
    for (const { file, state } of files) {
      if (state.trace === undefined) continue;
      const key = `${file.account}:${file.session}`;
      const session = sessions.get(key) ?? { accountId: file.account, sessionId: file.session, files: [] };
      const meta = file.agent === '' ? undefined : await this.metaOf(file);
      session.files.push({
        agent: file.agent,
        day: state.acc.result(),
        trace: state.trace.result(),
        ...(meta !== undefined ? { meta } : {}),
      });
      sessions.set(key, session);
    }
    const status = await this.statusByAgent(request.range.date);
    const git = await this.gitCommitsByProject([...sessions.values()], request.range);
    const person = this.personLookup();
    return buildTimelapse({
      date: request.range.date,
      start: request.range.start,
      end: request.range.end,
      now: this.deps.now(),
      account: request.label,
      sessions: [...sessions.values()],
      personOf: person,
      recordedOf: (agentId) => status.get(agentId),
      gitCommitsOf: (projectPath) => git.get(projectPath) ?? [],
      truncated,
    });
  }

  private async candidates(request: { range: DayRange; accounts: readonly Account[] }): Promise<TranscriptFile[]> {
    const found: TranscriptFile[] = [];
    for (const account of request.accounts) {
      const { files } = await discoverTranscripts(account.id, account.dir);
      for (const file of files) if (file.mtimeMs >= request.range.start) found.push(file);
    }
    return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  private async read(
    file: TranscriptFile,
    range: DayRange,
    budget: ReadBudget,
    trace: boolean,
  ): Promise<ReadState | undefined> {
    const key = `${file.account}|${file.rel}|${range.date}`;
    const previous = this.cache.get(key);
    try {
      const state = await readFileDay(
        file.path,
        { size: file.size, mtimeMs: file.mtimeMs, ino: file.ino },
        range,
        file.agent === '' ? 'main' : 'sub',
        previous,
        budget,
        { trace },
      );
      this.cache.delete(key);
      this.cache.set(key, state);
      if (this.cache.size > MAX_CACHED_FILES) this.cache.delete(this.cache.keys().next().value as string);
      return state;
    } catch (error) {
      this.deps.log.debug(`Relatório: não foi possível ler ${file.rel}: ${String(error)}`);
      return undefined;
    }
  }

  /** Tokens and estimated cost of every session on the day, from the usage index (subagents included). */
  private usageByKey(range: DayRange): Map<string, ReportUsage> {
    const totals = new Map<string, ReportUsage>();
    for (const row of this.deps.usage.rows()) {
      if (row.hour < floorToHour(range.start) || row.hour >= range.end) continue;
      const key = `${row.account}:${row.session}`;
      const known = totals.get(key) ?? { tokens: 0, costUSD: 0 };
      totals.set(key, { tokens: known.tokens + rowTokens(row), costUSD: known.costUSD + row.costUSD });
    }
    return totals;
  }

  private async statusByAgent(date: string): Promise<Map<string, { working: number; waiting: number; idle: number }>> {
    const result = new Map<string, { working: number; waiting: number; idle: number }>();
    try {
      for (const entry of (await this.deps.dayStats(date)).agents)
        result.set(entry.agentId, { working: entry.ms.working, waiting: entry.ms.waiting, idle: entry.ms.idle });
    } catch (error) {
      this.deps.log.debug(`Relatório: sem tempos de status: ${String(error)}`);
    }
    return result;
  }

  private nameLookup(): (accountId: string, sessionId: string) => string {
    const live = new Map(this.deps.agents().map((agent) => [agent.id, agent.name]));
    return (accountId, sessionId) => {
      const key = `${accountId}:${sessionId}`;
      return live.get(key) ?? this.deps.storedName(key) ?? pickName(key, new Set()).name;
    };
  }

  /** The `agent-<id>.meta.json` next to a subagent transcript (type, description, the tool call that spawned it). */
  private async metaOf(file: TranscriptFile): Promise<SubagentMeta | undefined> {
    const known = this.metas.get(file.path);
    if (known !== undefined) return known;
    try {
      const meta = parseSubagentMeta(
        asRecord(JSON.parse(await readFile(file.path.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as unknown),
      );
      this.metas.set(file.path, meta);
      if (this.metas.size > MAX_CACHED_META) this.metas.delete(this.metas.keys().next().value as string);
      return meta;
    } catch {
      return undefined;
    }
  }

  /** The person of an agent id: the name the office shows (live, else stored), else a stable pick. */
  private personLookup(): (agentId: string, taken: ReadonlySet<string>) => PersonName {
    const live = new Map(this.deps.agents().map((agent) => [agent.id, agent]));
    return (agentId, taken) => {
      const agent = live.get(agentId);
      const name = agent?.name ?? this.deps.storedName(agentId);
      if (name === undefined || taken.has(name)) return pickName(agentId, taken);
      return { name, look: agent?.look ?? findPerson(name)?.look ?? pickName(agentId, new Set()).look };
    };
  }

  private async gitCommitsByProject(
    sessions: readonly { files: readonly { day: FileDay }[] }[],
    range: DayRange,
  ): Promise<Map<string, readonly ReportCommit[]>> {
    const provider = this.deps.gitCommits;
    const found = new Map<string, readonly ReportCommit[]>();
    if (provider === undefined) return found;
    const paths = [
      ...new Set(
        sessions.flatMap((session) =>
          session.files.map((file) => file.day.cwd).filter((cwd): cwd is string => cwd !== undefined && cwd !== ''),
        ),
      ),
    ].slice(0, MAX_GIT_PROJECTS);
    await Promise.all(
      paths.map(async (path) => {
        try {
          found.set(path, await provider(path, range));
        } catch (error) {
          this.deps.log.debug(`Time-lapse: Git indisponível em ${path}: ${String(error)}`);
        }
      }),
    );
    return found;
  }

  private async withGitCommits(report: DayReport, range: DayRange): Promise<DayReport> {
    const provider = this.deps.gitCommits;
    if (provider === undefined) return report;
    const projects = await Promise.all(
      report.projects.map(async (project, index) => {
        if (project.id === '' || index >= MAX_GIT_PROJECTS) return project;
        try {
          const commits = await provider(project.id, range);
          return commits.length > 0 ? { ...project, gitCommits: [...commits] } : project;
        } catch (error) {
          this.deps.log.debug(`Relatório: Git indisponível em ${project.name}: ${String(error)}`);
          return project;
        }
      }),
    );
    return { ...report, projects };
  }
}
