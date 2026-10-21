// Folds the lines of ONE transcript (a session's main file or one subagent's) into the moments of its day: when the
// agent worked, waited or rested, what it was doing, how its task list changed, which shells ran. It reuses the live
// engine's own reducer (`TranscriptState`) and status rule (`deriveStatus`), fed with the line times as the clock.
//
// Approximations, because a transcript has no registry and no hooks:
// - A permission wait is only inferred for tools that finish instantly when allowed (file edits and writes): one that
//   stays pending past `PENDING_TOOL_WAIT_MS`. A Bash call, a web search or an MCP call that runs long is working (a
//   shell, past ten seconds), never a wait; the permission prompts of those tools are not seen. Questions and plan
//   approvals (`AskUserQuestion`, `ExitPlanMode`) are certain.
// - Without a registry a turn with no event for 10 minutes counts as finished (the live engine's rule).
// - A session is "present" while events are less than `TIMELAPSE_IDLE_LEAVE_MS` apart (`spans`).
import {
  type Activity,
  type Msg,
  type TimelapseActivity,
  type TimelapseShell,
  type TimelapseStatus,
  type TimelapseTask,
  TIMELAPSE_IDLE_LEAVE_MS,
} from '@ai-office/shared';
import { FOREGROUND_SHELL_AFTER_MS, TranscriptState } from '../claude/transcript-state';
import type { ParsedLine } from '../claude/types';
import { PENDING_TOOL_WAIT_MS, STALE_WORKING_NO_REGISTRY_MS, deriveStatus } from '../office/status';
import type { DayWindow } from '../report/accumulator';
import { safeActivity, safeShellLabel, safeTasks } from './sanitize';

/** Tools that finish at once when allowed (and ask first in the default mode): staying pending means a prompt is open. */
const INSTANT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
/** Activities that always stay, whatever the pace. */
const KEY_KINDS: ReadonlySet<string> = new Set(['prompt', 'error', 'done', 'subagent', 'question', 'permission']);
/** Fewest milliseconds between two ordinary activities of the same agent. */
export const ACTIVITY_GAP_MS = 5000;
/** A wait shorter than this is not worth a marker on the scrubber. */
export const WAIT_MARK_MIN_MS = 15_000;
/** Events one file keeps; past 1/2 and 3/4 of it the pace of ordinary activities slows down. */
export const MAX_TRACE_EVENTS = 6000;
const MAX_SPAWNS = 300;

export type TraceEvent =
  | { at: number; t: 'status'; status: TimelapseStatus; waitingFor?: string; waitingForMsg?: Msg }
  | ({ at: number; t: 'activity' } & Pick<TimelapseActivity, 'kind' | 'icon' | 'text' | 'msg' | 'error'>)
  | { at: number; t: 'tasks'; tasks: TimelapseTask[] }
  | ({ at: number; t: 'shell' } & Pick<TimelapseShell, 'on' | 'id' | 'background' | 'label' | 'labelMsg'>)
  | { at: number; t: 'permission'; tool: string; durationMs: number };

export interface TraceSpan {
  from: number;
  to: number;
}

export interface TraceSpawn {
  toolUseId: string;
  at: number;
  doneAt?: number;
  description: string;
  subagentType?: string;
}

/** What one transcript contributed to the day's time-lapse. */
export interface FileTrace {
  firstAt: number | undefined;
  lastAt: number | undefined;
  /** Session-defined title (`custom-title`), when the file has one. */
  title: string | undefined;
  /** Stretches of the day in which events are less than 30 minutes apart. */
  spans: readonly TraceSpan[];
  events: readonly TraceEvent[];
  spawns: readonly TraceSpawn[];
  /** Ordinary activities were dropped after the file's event budget ran out. */
  thinned: boolean;
}

interface Wait {
  since: number;
  tool: string;
}

interface StatusNow {
  status: TimelapseStatus;
  waitingFor?: string;
  waitingForMsg?: Msg;
  tool?: string;
}

export class TraceRecorder {
  private readonly state: TranscriptState;
  private readonly events: TraceEvent[] = [];
  private readonly spans: TraceSpan[] = [];
  private readonly shells = new Set<string>();
  private statusKey = '';
  private waiting: Wait | undefined;
  private taskSignature = '';
  private cursor: number | undefined;
  private firstAt: number | undefined;
  private lastAt: number | undefined;
  private lastOrdinary: { at: number; kind: string; text: string } | undefined;
  private thinned = false;

  constructor(
    private readonly window: DayWindow,
    isSub: boolean,
    private readonly maxEvents = MAX_TRACE_EVENTS,
  ) {
    this.state = new TranscriptState({ idPrefix: 'timelapse', isSub, historyLimit: 1 });
  }

  ingest(line: ParsedLine): void {
    if (line.kind === 'title') {
      this.state.apply(line);
      return;
    }
    if (!('at' in line) || line.at < this.window.start || line.at >= this.window.end) return;
    this.advance(line.at);
    const effects = this.state.apply(line);
    this.touch(line.at);
    for (const activity of effects.activities) this.recordActivity(activity);
    this.observe(line.at);
    this.recordTasks(line.at);
  }

  result(): FileTrace {
    const open = this.openWait();
    return {
      firstAt: this.firstAt,
      lastAt: this.lastAt,
      title: this.state.customTitle,
      spans: this.spans,
      events: open === undefined ? this.events : [...this.events, open],
      spawns: this.state.spawns().slice(0, MAX_SPAWNS).map((spawn) => ({
        toolUseId: spawn.toolUseId,
        at: spawn.at,
        description: spawn.description,
        ...(spawn.doneAt !== undefined ? { doneAt: spawn.doneAt } : {}),
        ...(spawn.subagentType !== undefined ? { subagentType: spawn.subagentType } : {}),
      })),
      thinned: this.thinned,
    };
  }

  // ---- time ------------------------------------------------------------------------------------------------------

  private touch(at: number): void {
    this.firstAt = Math.min(this.firstAt ?? at, at);
    this.lastAt = Math.max(this.lastAt ?? at, at);
    this.cursor = Math.max(this.cursor ?? at, at);
    const last = this.spans[this.spans.length - 1];
    if (last === undefined || at - last.to > TIMELAPSE_IDLE_LEAVE_MS) this.spans.push({ from: at, to: at });
    else last.to = Math.max(last.to, at);
  }

  /** Moments before `until`, with no line, at which what the agent is doing changes by itself. */
  private quietMoments(until: number): number[] {
    const moments = new Set<number>();
    for (const tool of this.state.pendingTools()) {
      if (INSTANT_TOOLS.has(tool.name)) moments.add(tool.at + PENDING_TOOL_WAIT_MS + 1);
      if (tool.name === 'Bash' && !tool.background) moments.add(tool.at + FOREGROUND_SHELL_AFTER_MS);
    }
    if (this.state.turn === 'working') moments.add(this.state.lastEventAt + STALE_WORKING_NO_REGISTRY_MS + 1);
    const from = this.cursor ?? Number.POSITIVE_INFINITY;
    return [...moments].filter((moment) => moment > from && moment < until).sort((a, b) => a - b);
  }

  private advance(until: number): void {
    if (this.cursor === undefined) return;
    for (const moment of this.quietMoments(until)) this.observe(moment);
  }

  // ---- status and shells -----------------------------------------------------------------------------------------

  private statusNow(at: number): StatusNow {
    const userTool = this.state.pendingUserTool();
    const instant = this.state.pendingTools().filter((tool) => INSTANT_TOOLS.has(tool.name)).sort((a, b) => a.at - b.at)[0];
    const blocked = instant !== undefined && at - instant.at > PENDING_TOOL_WAIT_MS;
    const derived = deriveStatus({
      now: at,
      turn: this.state.turn,
      lastEventAt: this.state.lastEventAt,
      permissionPending: false,
      ...(blocked ? { registryStatus: 'idle', blockingTool: { name: instant.name, at: instant.at } } : {}),
      ...(userTool !== undefined ? { pendingUserTool: userTool.waitingFor, pendingUserToolMsg: userTool.waitingForMsg } : {}),
    });
    const tool = userTool?.tool.name ?? (blocked ? instant.name : undefined);
    return {
      status: derived.status,
      ...(derived.waitingFor !== undefined ? { waitingFor: derived.waitingFor } : {}),
      ...(derived.waitingForMsg !== undefined ? { waitingForMsg: derived.waitingForMsg } : {}),
      ...(tool !== undefined ? { tool } : {}),
    };
  }

  private observe(at: number): void {
    this.setStatus(at, this.statusNow(at));
    this.syncShells(at);
  }

  private setStatus(at: number, next: StatusNow): void {
    const key = `${next.status}:${next.waitingFor ?? ''}`;
    if (key === this.statusKey) return;
    this.statusKey = key;
    if (this.waiting !== undefined) this.closeWait(at);
    if (next.status === 'waiting') this.waiting = { since: at, tool: next.tool ?? '' };
    this.events.push({
      at,
      t: 'status',
      status: next.status,
      ...(next.waitingFor !== undefined ? { waitingFor: next.waitingFor } : {}),
      ...(next.waitingForMsg !== undefined ? { waitingForMsg: next.waitingForMsg } : {}),
    });
  }

  private closeWait(at: number): void {
    const wait = this.waiting;
    this.waiting = undefined;
    if (wait !== undefined && at - wait.since >= WAIT_MARK_MIN_MS) this.events.push({ at: wait.since, t: 'permission', tool: wait.tool, durationMs: at - wait.since });
  }

  /** A wait still going at the last line, so far. */
  private openWait(): TraceEvent | undefined {
    const wait = this.waiting;
    const until = this.cursor;
    if (wait === undefined || until === undefined || until - wait.since < WAIT_MARK_MIN_MS) return undefined;
    return { at: wait.since, t: 'permission', tool: wait.tool, durationMs: until - wait.since };
  }

  private syncShells(at: number): void {
    const alive = new Map(this.state.shellsAt(at).map((job) => [job.id, job]));
    for (const [id, job] of alive) {
      if (this.shells.has(id)) continue;
      this.shells.add(id);
      this.events.push({ at, t: 'shell', on: true, id, background: job.background, ...safeShellLabel(job) });
    }
    for (const id of [...this.shells]) {
      if (alive.has(id)) continue;
      this.shells.delete(id);
      this.events.push({ at, t: 'shell', on: false, id, background: false });
    }
  }

  // ---- activities and tasks --------------------------------------------------------------------------------------

  private activityGap(): number {
    const size = this.events.length;
    return size >= this.maxEvents * 0.75 ? ACTIVITY_GAP_MS * 6 : size >= this.maxEvents * 0.5 ? ACTIVITY_GAP_MS * 3 : ACTIVITY_GAP_MS;
  }

  private recordActivity(activity: Activity): void {
    const safe = safeActivity(activity);
    if (!KEY_KINDS.has(safe.kind)) {
      const last = this.lastOrdinary;
      const tooSoon = last !== undefined && activity.at - last.at < this.activityGap();
      const repeat = last !== undefined && last.kind === safe.kind && last.text === safe.text;
      const spent = this.events.length >= this.maxEvents;
      if (spent) this.thinned = true;
      if (tooSoon || repeat || spent) return;
      this.lastOrdinary = { at: activity.at, kind: safe.kind, text: safe.text };
    }
    this.events.push({ at: activity.at, t: 'activity', ...safe });
  }

  private recordTasks(at: number): void {
    const tasks = this.state.tasks;
    const signature = tasks.map((task) => `${task.id}|${task.status}|${task.title}`).join('\n');
    if (signature === this.taskSignature) return;
    this.taskSignature = signature;
    this.events.push({ at, t: 'tasks', tasks: safeTasks(tasks) });
  }
}
