// Folds the parsed lines of ONE transcript file (a session's main transcript or one subagent's) into what the day
// report needs. Lines outside the day are ignored. Message bodies are never kept; the only text that is stored is the
// first line of each user prompt, which the report leaves out unless the caller asks for it.
import {
  type ActivityKind,
  REPORT_BUCKETS,
  REPORT_BUCKET_MS,
  type ReportCommand,
  type ReportCommit,
  type ReportFileChange,
  type ReportTask,
  type ReportTestRun,
  type ReportToolKind,
  type TaskItem,
  describeToolUse,
  truncate,
} from '@ai-office/shared';
import { asArray, asRecord, asString } from '../util/fs-safe';
import { appendTask, renameTask, tasksFromTodoWrite, updateTask } from '../claude/tasks';
import type { ParsedLine, ToolResultInfo } from '../claude/types';
import { detectTestRunner, displayCommand, isGitCommit, parseCommits, parseTestOutcome } from './commands';

/** A pause longer than this between two events is not counted as work. */
export const ACTIVE_GAP_MS = 10 * 60_000;
export const REQUEST_MAX = 140;
const MAX_PENDING = 400;
const MAX_FILES = 300;
const MAX_COMMANDS = 150;
const MAX_ITEMS = 100;

export interface DayWindow {
  start: number;
  end: number;
}

export type FileRole = 'main' | 'sub';

/** What one file contributed to the day. */
export interface FileDay {
  role: FileRole;
  /** Working directory seen in the file. */
  cwd: string | undefined;
  /** Custom session title, when the file has one. */
  title: string | undefined;
  firstAt: number | undefined;
  lastAt: number | undefined;
  prompts: number;
  requests: string[];
  toolCalls: Partial<Record<ReportToolKind, number>>;
  files: ReportFileChange[];
  commands: ReportCommand[];
  tests: ReportTestRun[];
  commits: ReportCommit[];
  tasks: ReportTask[];
  subagentCount: number;
  subagentTypes: string[];
  activity: number[];
}

interface Pending {
  name: string;
  input: Record<string, unknown>;
  at: number;
}

const KIND_MAP: Partial<Record<ActivityKind, ReportToolKind>> = {
  read: 'read',
  search: 'search',
  edit: 'edit',
  write: 'write',
  bash: 'bash',
  web: 'web',
  task: 'task',
  subagent: 'subagent',
  mcp: 'mcp',
  question: 'question',
};

const FILE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

function lineCount(text: string | undefined): number {
  return text === undefined || text.length === 0 ? 0 : text.split('\n').length;
}

/** Lines changed by a file tool, estimated from its input (used when the result carries no patch). */
function estimateLines(name: string, input: Record<string, unknown>): { added: number; removed: number } {
  if (name === 'Write') return { added: lineCount(asString(input.content)), removed: 0 };
  if (name === 'NotebookEdit') return { added: lineCount(asString(input.new_source)), removed: 0 };
  const edits: Record<string, unknown>[] = name === 'MultiEdit' ? asArray(input.edits).map(asRecord) : [input];
  return edits.reduce<{ added: number; removed: number }>((sum, edit) => ({ added: sum.added + lineCount(asString(edit.new_string)), removed: sum.removed + lineCount(asString(edit.old_string)) }), { added: 0, removed: 0 });
}

export class FileDayAccumulator {
  private cwd: string | undefined;
  private title: string | undefined;
  private firstAt: number | undefined;
  private lastAt: number | undefined;
  private previousAt: number | undefined;
  private prompts = 0;
  private readonly requests: string[] = [];
  private readonly toolCalls: Partial<Record<ReportToolKind, number>> = {};
  private readonly files = new Map<string, ReportFileChange>();
  private readonly commands = new Map<string, number>();
  private readonly tests: ReportTestRun[] = [];
  private readonly commits: ReportCommit[] = [];
  private readonly completed = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  private readonly subagentTypes = new Set<string>();
  private subagentCount = 0;
  private readonly activity = new Array<number>(REPORT_BUCKETS).fill(0);
  /** The task list as of the last TodoWrite / TaskCreate; undefined while it is not known (the session began earlier). */
  private taskList: TaskItem[] | undefined;

  /** `startedInDay`: the file began during the day, so its task list starts empty and every completion happened today. */
  constructor(
    private readonly window: DayWindow,
    private readonly role: FileRole,
    startedInDay: boolean,
  ) {
    this.taskList = startedInDay ? [] : undefined;
  }

  ingest(line: ParsedLine): void {
    if (line.kind === 'title') {
      this.title = line.title;
      return;
    }
    if (!('at' in line) || line.at < this.window.start || line.at >= this.window.end) return;
    this.touch(line.at, line.cwd);
    switch (line.kind) {
      case 'prompt':
        this.countPrompt(line.text);
        return;
      case 'assistant':
        for (const block of line.blocks) if (block.type === 'tool_use') this.onToolUse(block.id, block.name, block.input, line.at);
        return;
      case 'tool-results':
        for (const result of line.results) this.onResult(result, line.results.length === 1 ? line.structured : undefined, line.at);
        return;
      default:
        return;
    }
  }

  private touch(at: number, cwd: string | undefined): void {
    this.cwd ??= cwd;
    this.firstAt = Math.min(this.firstAt ?? at, at);
    this.lastAt = Math.max(this.lastAt ?? at, at);
    if (this.previousAt !== undefined && at > this.previousAt && at - this.previousAt <= ACTIVE_GAP_MS) this.addSpan(this.previousAt, at);
    if (this.previousAt === undefined || at > this.previousAt) this.previousAt = at;
  }

  private addSpan(from: number, to: number): void {
    let cursor = from;
    while (cursor < to) {
      const index = Math.min(REPORT_BUCKETS - 1, Math.floor((cursor - this.window.start) / REPORT_BUCKET_MS));
      const bucketEnd = index === REPORT_BUCKETS - 1 ? to : this.window.start + (index + 1) * REPORT_BUCKET_MS;
      const stop = Math.min(to, bucketEnd);
      this.activity[index] = (this.activity[index] ?? 0) + (stop - cursor);
      cursor = stop;
    }
  }

  private countPrompt(text: string): void {
    if (this.role !== 'main') return;
    this.prompts++;
    const first = text.split('\n').find((row) => row.trim().length > 0);
    if (first !== undefined && this.requests.length < MAX_ITEMS) this.requests.push(truncate(first, REQUEST_MAX));
  }

  // ---- tool calls -------------------------------------------------------------------------------------------

  private onToolUse(id: string, name: string, input: Record<string, unknown>, at: number): void {
    const kind = KIND_MAP[describeToolUse(name, input).kind] ?? 'other';
    this.toolCalls[kind] = (this.toolCalls[kind] ?? 0) + 1;
    if (this.pending.size >= MAX_PENDING) this.pending.delete(this.pending.keys().next().value as string);
    this.pending.set(id, { name, input, at });
    if (name === 'Bash') this.countCommand(asString(input.command));
    else if (name === 'Task' || name === 'Agent') this.countSubagent(input);
    else if (name === 'TodoWrite' || name === 'TaskCreate' || name === 'TaskUpdate') this.onTaskTool(id, name, input, at);
  }

  private countCommand(command: string | undefined): void {
    if (command === undefined) return;
    const shown = displayCommand(command);
    if (shown.length === 0) return;
    if (!this.commands.has(shown) && this.commands.size >= MAX_COMMANDS) return;
    this.commands.set(shown, (this.commands.get(shown) ?? 0) + 1);
  }

  private countSubagent(input: Record<string, unknown>): void {
    this.subagentCount++;
    this.subagentTypes.add(asString(input.subagent_type) ?? 'general-purpose');
  }

  private onResult(result: ToolResultInfo, structured: { linesAdded: number; linesRemoved: number; createdTaskId?: string } | undefined, at: number): void {
    const call = this.pending.get(result.toolUseId);
    if (call === undefined) return;
    this.pending.delete(result.toolUseId);
    if (call.name === 'TaskCreate' && structured?.createdTaskId !== undefined && this.taskList !== undefined) {
      this.taskList = renameTask(this.taskList, result.toolUseId, structured.createdTaskId);
    } else if (FILE_TOOLS.has(call.name)) {
      if (!result.isError) this.recordFile(call, structured);
    } else if (call.name === 'Bash') {
      this.onBashResult(call, result, at);
    }
  }

  private recordFile(call: Pending, structured: { linesAdded: number; linesRemoved: number } | undefined): void {
    const path = asString(call.input.file_path) ?? asString(call.input.notebook_path) ?? asString(call.input.path);
    if (path === undefined) return;
    if (!this.files.has(path) && this.files.size >= MAX_FILES) return;
    const lines = structured !== undefined && (structured.linesAdded > 0 || structured.linesRemoved > 0) ? { added: structured.linesAdded, removed: structured.linesRemoved } : estimateLines(call.name, call.input);
    const before = this.files.get(path);
    this.files.set(path, { path, edits: (before?.edits ?? 0) + 1, added: (before?.added ?? 0) + lines.added, removed: (before?.removed ?? 0) + lines.removed });
  }

  private onBashResult(call: Pending, result: ToolResultInfo, at: number): void {
    const command = asString(call.input.command) ?? '';
    const runner = detectTestRunner(command);
    if (runner !== undefined && this.tests.length < MAX_ITEMS) this.tests.push({ runner, at: call.at, ...parseTestOutcome(result.text, result.isError) });
    if (result.isError || !isGitCommit(command)) return;
    for (const commit of parseCommits(result.text)) {
      if (this.commits.length < MAX_ITEMS && !this.commits.some((known) => known.hash === commit.hash)) this.commits.push({ ...commit, at, source: 'transcript' });
    }
  }

  // ---- tasks ------------------------------------------------------------------------------------------------

  private onTaskTool(id: string, name: string, input: Record<string, unknown>, at: number): void {
    if (name === 'TodoWrite') {
      const next = tasksFromTodoWrite(input);
      const before = this.taskList;
      if (before !== undefined) {
        for (const task of next) {
          const old = before.find((item) => item.title === task.title);
          if (task.status === 'completed' && old?.status !== 'completed') this.complete(task.title, at);
        }
      }
      this.taskList = next;
    } else if (name === 'TaskCreate') {
      this.taskList = appendTask(this.taskList ?? [], input, id);
    } else if (this.taskList !== undefined) {
      const before = this.taskList;
      this.taskList = updateTask(before, input);
      for (const task of this.taskList) {
        const old = before.find((item) => item.id === task.id);
        if (task.status === 'completed' && old?.status !== 'completed') this.complete(task.title, at);
      }
    }
  }

  private complete(title: string, at: number): void {
    if (!this.completed.has(title) && this.completed.size < MAX_ITEMS) this.completed.set(title, at);
  }

  result(): FileDay {
    return {
      role: this.role,
      cwd: this.cwd,
      title: this.title,
      firstAt: this.firstAt,
      lastAt: this.lastAt,
      prompts: this.prompts,
      requests: [...this.requests],
      toolCalls: { ...this.toolCalls },
      files: [...this.files.values()].sort((a, b) => b.edits - a.edits || a.path.localeCompare(b.path)),
      commands: [...this.commands].map(([command, runs]) => ({ command, runs })).sort((a, b) => b.runs - a.runs),
      tests: [...this.tests],
      commits: [...this.commits],
      tasks: [...this.completed].map(([title, at]) => ({ title, at })).sort((a, b) => a.at - b.at),
      subagentCount: this.subagentCount,
      subagentTypes: [...this.subagentTypes],
      activity: [...this.activity],
    };
  }
}
