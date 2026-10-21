// Reducer for one transcript (a main session or a subagent): feed it ParsedLines in order, read the state back.
import {
  type Activity,
  type ActivityDraft,
  type AgentStats,
  type ShellJob,
  type TaskItem,
  type Msg,
  describeToolUse,
  doneDraft,
  errorDraft,
  msg,
  promptDraft,
  replyDraft,
  sourceText,
  thinkingDraft,
  toActivity,
  truncate,
} from '@ai-office/shared';
import { asString } from '../util/fs-safe';
import { StatsAccumulator } from './stats';
import { appendTask, renameTask, stampTaskChanges, tasksFromTodoWrite, updateTask } from './tasks';
import { END_STOP_REASONS, type ParsedLine, type StructuredResult } from './types';

const RECENT_LIMIT = 30;
const HISTORY_LIMIT = 300;
const MAX_RESULT_IDS = 2000;
/** A foreground Bash call running this long counts as a shell job. */
export const FOREGROUND_SHELL_AFTER_MS = 10_000;
const USER_TOOLS: Readonly<Record<string, Msg>> = {
  AskUserQuestion: msg('waiting.answerQuestion'),
  ExitPlanMode: msg('waiting.approvePlan'),
};

export interface PendingTool {
  id: string;
  name: string;
  at: number;
  input: Record<string, unknown>;
  background: boolean;
}

export interface SpawnInfo {
  toolUseId: string;
  description: string;
  subagentType?: string;
  at: number;
  async: boolean;
  done: boolean;
  /** When the completion (result or notification) was seen. */
  doneAt?: number;
  agentId?: string;
}

/** What one applied line produced (consumed by the office for feed, notices and permissions). */
export interface ApplyEffects {
  activities: Activity[];
  promptSeen: boolean;
  interrupted: boolean;
  newAssistantMessage: boolean;
  toolResults: { toolUseId: string; name: string }[];
  turnCompleted?: { durationMs: number };
  error?: { tool: string; detail?: string };
}

export interface TranscriptStateOptions {
  /** Prefix for activity ids. */
  idPrefix: string;
  isSub: boolean;
  /** Activities kept in the history (default 300); the time-lapse recorder keeps none, it reads them from the effects. */
  historyLimit?: number;
}

export type TurnState = 'working' | 'idle';

function emptyEffects(): ApplyEffects {
  return { activities: [], promptSeen: false, interrupted: false, newAssistantMessage: false, toolResults: [] };
}

export class TranscriptState {
  private readonly stats = new StatsAccumulator();
  private readonly history: Activity[] = [];
  private readonly pending = new Map<string, PendingTool>();
  private readonly spawnMap = new Map<string, SpawnInfo>();
  private readonly jobs = new Map<string, ShellJob>();
  private readonly taskAliases = new Map<string, string>();
  private readonly resultIds = new Set<string>();
  private seq = 0;
  private lastMessageId: string | undefined;
  private tasksList: TaskItem[] = [];

  turn: TurnState = 'idle';
  turnStartedAt = 0;
  lastEventAt = 0;
  firstEventAt = 0;
  customTitle: string | undefined;
  firstPrompt: string | undefined;
  lastPrompt: string | undefined;
  model: string | undefined;
  gitBranch: string | undefined;
  permissionMode: string | undefined;
  cwd: string | undefined;
  sawAny = false;

  constructor(private readonly options: TranscriptStateOptions) {}

  get tasks(): readonly TaskItem[] {
    return this.tasksList;
  }

  get activity(): Activity | undefined {
    return this.history[this.history.length - 1];
  }

  recent(): Activity[] {
    return this.history.slice(-RECENT_LIMIT);
  }

  activityHistory(): Activity[] {
    return [...this.history];
  }

  spawns(): SpawnInfo[] {
    return [...this.spawnMap.values()];
  }

  spawn(toolUseId: string): SpawnInfo | undefined {
    return this.spawnMap.get(toolUseId);
  }

  /** True when the tool call finished (a result or notification was seen), even if the tool_use was not read. */
  isFinished(toolUseId: string): boolean {
    return this.resultIds.has(toolUseId);
  }

  pendingTools(): PendingTool[] {
    return [...this.pending.values()];
  }

  /** A tool that needs the user (question, plan approval), with the text for "waitingFor". */
  pendingUserTool(): { tool: PendingTool; waitingFor: string; waitingForMsg: Msg } | undefined {
    for (const tool of this.pending.values()) {
      const waitingForMsg = USER_TOOLS[tool.name];
      if (waitingForMsg !== undefined) return { tool, waitingFor: sourceText(waitingForMsg), waitingForMsg };
    }
    return undefined;
  }

  /** Oldest pending tool that would normally finish quickly (excludes delegation and user tools). */
  oldestBlockingTool(): PendingTool | undefined {
    let oldest: PendingTool | undefined;
    for (const tool of this.pending.values()) {
      if (tool.background || tool.name in USER_TOOLS || tool.name === 'Task' || tool.name === 'Agent') continue;
      if (oldest === undefined || tool.at < oldest.at) oldest = tool;
    }
    return oldest;
  }

  /** Background shells and monitors, plus foreground Bash calls running longer than 10 s. */
  shellsAt(now: number): ShellJob[] {
    const shells = [...this.jobs.values()];
    for (const tool of this.pending.values()) {
      if (tool.name !== 'Bash' || tool.background || this.jobs.has(tool.id)) continue;
      if (now - tool.at < FOREGROUND_SHELL_AFTER_MS) continue;
      const draft = describeToolUse('Bash', tool.input);
      shells.push({ id: tool.id, label: draft.text, labelMsg: draft.msg, ...(draft.detail ? { command: draft.detail } : {}), background: false, kind: 'shell', startedAt: tool.at });
    }
    return shells;
  }

  statsSnapshot(): AgentStats {
    return this.stats.snapshot(this.spawnMap.size);
  }

  /** Display title: custom title, else first prompt, else last prompt (80 chars max). */
  title(): string | undefined {
    const raw = this.customTitle ?? this.firstPrompt ?? this.lastPrompt;
    return raw === undefined ? undefined : truncate(raw, 80);
  }

  /** Records an activity that does not come from the transcript (message delivered, permission requested...). */
  addExternal(draft: ActivityDraft, at: number): Activity {
    const effects = emptyEffects();
    this.push(draft, at, effects);
    return effects.activities[0] as Activity;
  }

  apply(line: ParsedLine): ApplyEffects {
    const effects = emptyEffects();
    switch (line.kind) {
      case 'title':
        this.customTitle = line.title;
        return effects;
      case 'last-prompt':
        this.lastPrompt = line.text;
        return effects;
      case 'mode':
        this.permissionMode ??= line.mode;
        return effects;
      case 'cost-state':
        this.stats.setBaseline(line.costUSD, line.linesAdded, line.linesRemoved);
        return effects;
      default:
        break;
    }
    this.touch(line.at);
    if (line.cwd !== undefined) this.cwd = line.cwd;
    if (line.gitBranch !== undefined) this.gitBranch = line.gitBranch;
    if (line.permissionMode !== undefined) this.permissionMode = line.permissionMode;
    switch (line.kind) {
      case 'prompt':
        this.onPrompt(line.text, line.at, effects);
        break;
      case 'interrupt':
        this.onInterrupt(effects);
        break;
      case 'tool-results':
        this.onResults(line, effects);
        break;
      case 'assistant':
        this.onAssistant(line, effects);
        break;
      case 'notification':
        this.onNotification(line.toolUseId, line.taskId, line.at);
        break;
      default:
        break;
    }
    return effects;
  }

  private touch(at: number): void {
    this.sawAny = true;
    if (this.firstEventAt === 0) this.firstEventAt = at;
    if (at > this.lastEventAt) this.lastEventAt = at;
  }

  private push(draft: ActivityDraft, at: number, effects: ApplyEffects): void {
    const activity = toActivity(draft, `${this.options.idPrefix}#${++this.seq}`, at);
    this.history.push(activity);
    if (this.history.length > (this.options.historyLimit ?? HISTORY_LIMIT)) this.history.shift();
    effects.activities.push(activity);
  }

  private onPrompt(text: string, at: number, effects: ApplyEffects): void {
    this.firstPrompt ??= text;
    this.lastPrompt = text;
    effects.promptSeen = true;
    this.turn = 'working';
    this.turnStartedAt = at;
    this.dropForegroundTools();
    if (!this.options.isSub) this.push(promptDraft(text), at, effects);
  }

  private onInterrupt(effects: ApplyEffects): void {
    this.turn = 'idle';
    effects.interrupted = true;
    this.dropForegroundTools();
  }

  private dropForegroundTools(): void {
    for (const [id, tool] of this.pending) {
      if (!tool.background && tool.name !== 'Task' && tool.name !== 'Agent') this.pending.delete(id);
    }
  }

  private rememberResult(id: string): void {
    this.resultIds.add(id);
    if (this.resultIds.size > MAX_RESULT_IDS) {
      const oldest = this.resultIds.values().next().value;
      if (oldest !== undefined) this.resultIds.delete(oldest);
    }
  }

  private onResults(line: Extract<ParsedLine, { kind: 'tool-results' }>, effects: ApplyEffects): void {
    this.turn = 'working';
    if (this.turnStartedAt === 0) this.turnStartedAt = line.at;
    for (const result of line.results) {
      const tool = this.pending.get(result.toolUseId);
      this.pending.delete(result.toolUseId);
      this.rememberResult(result.toolUseId);
      const name = tool?.name ?? 'ferramenta';
      effects.toolResults.push({ toolUseId: result.toolUseId, name });
      if (line.structured !== undefined) this.applyStructured(result.toolUseId, tool, line.structured);
      if (tool !== undefined && !(tool.name in USER_TOOLS) && !line.structured?.asyncAgent) this.finishTool(tool, line.structured, line.at);
      if (result.isError) {
        effects.error = { tool: name, detail: result.text.slice(0, 400) };
        this.push(errorDraft(name, result.text), line.at, effects);
      }
    }
  }

  private finishTool(tool: PendingTool, structured: StructuredResult | undefined, at: number): void {
    const spawn = this.spawnMap.get(tool.id);
    if (spawn !== undefined && !(structured?.asyncAgent ?? false)) this.spawnMap.set(tool.id, { ...spawn, done: true, doneAt: at });
    if (tool.name === 'Bash' && !tool.background) this.jobs.delete(tool.id);
  }

  private applyStructured(toolUseId: string, tool: PendingTool | undefined, structured: StructuredResult): void {
    this.stats.addLines(structured.linesAdded, structured.linesRemoved);
    if (structured.backgroundTaskId !== undefined) this.taskAliases.set(structured.backgroundTaskId, toolUseId);
    const spawn = this.spawnMap.get(toolUseId);
    if (spawn !== undefined && structured.asyncAgent) {
      this.spawnMap.set(toolUseId, { ...spawn, async: true, ...(structured.agentId !== undefined ? { agentId: structured.agentId } : {}) });
    }
    if (tool?.name === 'TaskCreate' && structured.createdTaskId !== undefined) {
      this.tasksList = renameTask(this.tasksList, `pending:${toolUseId}`, structured.createdTaskId);
    }
  }

  private onNotification(toolUseId: string | undefined, taskId: string | undefined, at: number): void {
    const ids = [toolUseId, taskId].filter((id): id is string => id !== undefined);
    for (const id of ids) {
      const resolved = this.taskAliases.get(id) ?? id;
      this.jobs.delete(resolved);
      this.pending.delete(resolved);
      this.rememberResult(resolved);
      const spawn = this.spawnMap.get(resolved) ?? [...this.spawnMap.values()].find((candidate) => candidate.agentId === id);
      if (spawn !== undefined) this.spawnMap.set(spawn.toolUseId, { ...spawn, done: true, doneAt: at });
    }
  }

  private onAssistant(line: Extract<ParsedLine, { kind: 'assistant' }>, effects: ApplyEffects): void {
    if (line.messageId !== undefined && line.messageId !== this.lastMessageId) {
      this.lastMessageId = line.messageId;
      effects.newAssistantMessage = true;
    }
    if (line.model !== undefined) this.model = line.model;
    if (line.usage !== undefined) this.stats.addUsage(line.messageId, line.model, line.usage);
    if (line.apiError) this.push(errorDraft('API', line.blocks.map((b) => (b.type === 'text' ? b.text : '')).join(' ')), line.at, effects);
    for (const block of line.blocks) {
      if (block.type === 'thinking') this.push(thinkingDraft(), line.at, effects);
      else if (block.type === 'text' && !line.apiError) this.push(replyDraft(block.text), line.at, effects);
      else if (block.type === 'tool_use') this.onToolUse(block.id, block.name, block.input, line.at, effects);
    }
    if (line.stopReason !== undefined && END_STOP_REASONS.has(line.stopReason)) this.endTurn(line.at, effects);
    else if (this.turn === 'idle' && line.blocks.length > 0) {
      this.turn = 'working';
      if (this.turnStartedAt === 0) this.turnStartedAt = line.at;
    }
  }

  private endTurn(at: number, effects: ApplyEffects): void {
    if (this.turn !== 'working') return;
    this.turn = 'idle';
    if (this.options.isSub) return;
    const durationMs = this.turnStartedAt > 0 ? Math.max(0, at - this.turnStartedAt) : 0;
    effects.turnCompleted = { durationMs };
    this.push(doneDraft(durationMs), at, effects);
  }

  private onToolUse(id: string, name: string, input: Record<string, unknown>, at: number, effects: ApplyEffects): void {
    const background = input.run_in_background === true;
    this.pending.set(id, { id, name, at, input, background });
    this.stats.countToolCall();
    this.push(describeToolUse(name, input), at, effects);
    if (name === 'Task' || name === 'Agent') this.registerSpawn(id, input, at, background);
    else if (name === 'Bash' && background) this.addJob(id, input, 'shell', at);
    else if (name === 'Monitor') this.addJob(id, input, 'monitor', at);
    else if (name === 'KillShell' || name === 'TaskStop') this.removeJob(input);
    else if (name === 'TodoWrite') this.tasksList = stampTaskChanges(this.tasksList, tasksFromTodoWrite(input), at);
    else if (name === 'TaskCreate') this.tasksList = stampTaskChanges(this.tasksList, appendTask(this.tasksList, input, `pending:${id}`), at);
    else if (name === 'TaskUpdate') this.tasksList = stampTaskChanges(this.tasksList, updateTask(this.tasksList, input), at);
  }

  private registerSpawn(id: string, input: Record<string, unknown>, at: number, background: boolean): void {
    const subagentType = asString(input.subagent_type);
    this.spawnMap.set(id, {
      toolUseId: id,
      description: asString(input.description) ?? subagentType ?? 'Subagente',
      ...(subagentType !== undefined ? { subagentType } : {}),
      at,
      async: background,
      done: false,
    });
  }

  private addJob(id: string, input: Record<string, unknown>, kind: ShellJob['kind'], at: number): void {
    const draft = describeToolUse(kind === 'monitor' ? 'Monitor' : 'Bash', input);
    const command = asString(input.command);
    this.jobs.set(id, { id, label: draft.text, labelMsg: draft.msg, ...(command !== undefined ? { command } : {}), background: true, kind, startedAt: at });
  }

  private removeJob(input: Record<string, unknown>): void {
    const raw = asString(input.shell_id) ?? asString(input.task_id) ?? asString(input.id);
    if (raw === undefined) return;
    this.jobs.delete(this.taskAliases.get(raw) ?? raw);
  }
}
