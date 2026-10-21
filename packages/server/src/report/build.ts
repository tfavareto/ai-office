// Turns the per-file results of a day into the report: one agent per session (its subagents' work is folded in),
// grouped by project. Pure: names, usage and recorded status times come in through callbacks.
import {
  REPORT_BUCKETS,
  REPORT_BUCKET_MS,
  type DayReport,
  type ReportAgent,
  type ReportCommand,
  type ReportFileChange,
  type ReportProject,
  type ReportTask,
  type ReportToolKind,
  type ReportUsage,
  basename,
  mergeCommits,
} from '@ai-office/shared';
import type { FileDay } from './accumulator';

const MAX_FILES = 100;
const MAX_COMMANDS = 40;
const MAX_ITEMS = 40;

export interface SessionDay {
  accountId: string;
  sessionId: string;
  /** The main transcript's result and each subagent's. */
  files: readonly FileDay[];
}

export interface BuildInput {
  date: string;
  now: number;
  /** An account id or "all". */
  account: string;
  includeRequests: boolean;
  sessions: readonly SessionDay[];
  nameOf: (accountId: string, sessionId: string) => string;
  usageOf: (accountId: string, sessionId: string) => ReportUsage;
  statusOf: (agentId: string) => ReportAgent['statusMs'];
  truncated: boolean;
  usageIndexing: boolean;
}

function relativePath(path: string, cwd: string | undefined): string {
  return cwd !== undefined && cwd.length > 0 && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
}

function mergeFiles(files: readonly FileDay[], cwd: string | undefined): ReportFileChange[] {
  const merged = new Map<string, ReportFileChange>();
  for (const day of files) {
    for (const file of day.files) {
      const path = relativePath(file.path, cwd);
      const known = merged.get(path);
      merged.set(path, { path, edits: (known?.edits ?? 0) + file.edits, added: (known?.added ?? 0) + file.added, removed: (known?.removed ?? 0) + file.removed });
    }
  }
  return [...merged.values()].sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path)).slice(0, MAX_FILES);
}

function mergeCommands(files: readonly FileDay[]): ReportCommand[] {
  const merged = new Map<string, number>();
  for (const day of files) for (const entry of day.commands) merged.set(entry.command, (merged.get(entry.command) ?? 0) + entry.runs);
  return [...merged].map(([command, runs]) => ({ command, runs })).sort((a, b) => b.runs - a.runs || a.command.localeCompare(b.command)).slice(0, MAX_COMMANDS);
}

function mergeTasks(files: readonly FileDay[]): ReportTask[] {
  const merged = new Map<string, number>();
  for (const day of files) for (const task of day.tasks) merged.set(task.title, Math.min(merged.get(task.title) ?? task.at, task.at));
  return [...merged].map(([title, at]) => ({ title, at })).sort((a, b) => a.at - b.at).slice(0, MAX_ITEMS);
}

function mergeToolCalls(files: readonly FileDay[]): Partial<Record<ReportToolKind, number>> {
  const total: Partial<Record<ReportToolKind, number>> = {};
  for (const day of files) for (const [kind, count] of Object.entries(day.toolCalls) as [ReportToolKind, number][]) total[kind] = (total[kind] ?? 0) + count;
  return total;
}

/** Work in parallel (the main agent and its subagents) overlaps, so each half hour takes the busiest file, not the sum. */
function mergeActivity(files: readonly FileDay[]): number[] {
  return Array.from({ length: REPORT_BUCKETS }, (_, i) => Math.min(REPORT_BUCKET_MS, Math.max(0, ...files.map((day) => day.activity[i] ?? 0))));
}

function buildAgent(session: SessionDay, input: BuildInput): ReportAgent | undefined {
  const first = session.files.map((day) => day.firstAt).filter((at): at is number => at !== undefined);
  const last = session.files.map((day) => day.lastAt).filter((at): at is number => at !== undefined);
  if (first.length === 0) return undefined;
  const cwd = session.files.find((day) => day.role === 'main')?.cwd ?? session.files.find((day) => day.cwd !== undefined)?.cwd;
  const agentId = `${session.accountId}:${session.sessionId}`;
  const activity = mergeActivity(session.files);
  const requests = session.files.flatMap((day) => day.requests).slice(0, MAX_ITEMS);
  const statusMs = input.statusOf(agentId);
  return {
    agentId,
    accountId: session.accountId,
    sessionId: session.sessionId,
    name: input.nameOf(session.accountId, session.sessionId),
    firstAt: Math.min(...first),
    lastAt: Math.max(...last),
    activeMs: activity.reduce((sum, ms) => sum + ms, 0),
    ...(statusMs !== undefined ? { statusMs } : {}),
    prompts: session.files.reduce((sum, day) => sum + day.prompts, 0),
    ...(input.includeRequests ? { requests } : {}),
    toolCalls: mergeToolCalls(session.files),
    files: mergeFiles(session.files, cwd),
    commands: mergeCommands(session.files),
    tests: session.files.flatMap((day) => day.tests).sort((a, b) => a.at - b.at).slice(0, MAX_ITEMS),
    commits: mergeCommits(...session.files.map((day) => day.commits)).slice(0, MAX_ITEMS),
    tasks: mergeTasks(session.files),
    subagents: { count: session.files.reduce((sum, day) => sum + day.subagentCount, 0), types: [...new Set(session.files.flatMap((day) => day.subagentTypes))] },
    usage: input.usageOf(session.accountId, session.sessionId),
    activity,
  };
}

/** The working directory of a session: the main transcript's, else any subagent's. */
function projectOf(session: SessionDay): string {
  return session.files.find((day) => day.role === 'main')?.cwd ?? session.files.find((day) => day.cwd !== undefined)?.cwd ?? '';
}

export function buildDayReport(input: BuildInput): DayReport {
  const byProject = new Map<string, ReportAgent[]>();
  for (const session of input.sessions) {
    const agent = buildAgent(session, input);
    if (agent === undefined) continue;
    const project = projectOf(session);
    byProject.set(project, [...(byProject.get(project) ?? []), agent]);
  }
  const projects: ReportProject[] = [...byProject]
    .map(([id, agents]) => ({ id, name: id === '' ? '' : basename(id), agents: agents.sort((a, b) => b.activeMs - a.activeMs || a.name.localeCompare(b.name)) }))
    .sort((a, b) => sum(b.agents) - sum(a.agents) || a.name.localeCompare(b.name));
  return {
    date: input.date,
    generatedAt: input.now,
    account: input.account,
    includeRequests: input.includeRequests,
    projects,
    ...(input.truncated ? { truncated: true } : {}),
    ...(input.usageIndexing ? { usageIndexing: true } : {}),
  };
}

function sum(agents: readonly ReportAgent[]): number {
  return agents.reduce((total, agent) => total + agent.activeMs, 0);
}
