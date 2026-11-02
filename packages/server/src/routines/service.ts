// Routines: a prompt that runs on a schedule. At its time a routine types into an idle real terminal of its project, or
// starts one; while the agent is busy it tries again soon, and it runs nothing while real terminals are off. A turn missed
// with the office closed runs once. Routines run one at a time, so each sees what the one before it did to the terminals,
// and two never share a prompt. Permissions work as usual: a routine never answers any.
import { isAbsolute } from 'node:path';
import {
  type Routine,
  type RoutineOutcome,
  type RoutineSchedule,
  ROUTINE_MAX_NAME,
  ROUTINE_MAX_PROMPT,
} from '@ai-office/shared';

export const MAX_ROUTINES = 20;
/** Agents cost money: nothing runs more often than this. */
export const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
const HISTORY_LIMIT = 20;
const RETRY_MINUTES = 5;
const OUTCOMES: readonly RoutineOutcome[] = ['sent', 'started', 'skipped-busy', 'skipped-off', 'failed'];
const MINUTE_MS = 60_000;

export interface RoutineInput {
  name: string;
  prompt: string;
  projectPath: string;
  schedule: RoutineSchedule;
}

export interface RoutineDeps {
  now: () => number;
  newId: () => string;
  /** Real terminals are on. */
  enabled: () => boolean;
  /** The real terminals working in a folder. */
  terminalsIn: (projectPath: string) => readonly { id: string; busy: boolean }[];
  paste: (terminalId: string, text: string) => boolean;
  /** Starts a real terminal in the folder with this first prompt. */
  start: (projectPath: string, prompt: string) => Promise<void>;
  onChange: () => void;
}

export class RoutineLimitError extends Error {
  constructor() {
    super('too-many');
    this.name = 'RoutineLimitError';
  }
}

export function nextRunAt(schedule: RoutineSchedule, after: number): number {
  if (schedule.kind === 'interval') return after + schedule.minutes * MINUTE_MS;
  const next = new Date(after);
  next.setHours(schedule.hour, schedule.minute, 0, 0);
  if (next.getTime() <= after) next.setDate(next.getDate() + 1);
  return next.getTime();
}

function parseSchedule(raw: unknown): RoutineSchedule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (data.kind === 'interval') {
    const { minutes } = data;
    if (!Number.isInteger(minutes)) return null;
    const value = minutes as number;
    return value >= MIN_INTERVAL_MINUTES && value <= MAX_INTERVAL_MINUTES ? { kind: 'interval', minutes: value } : null;
  }
  if (data.kind === 'daily') {
    const { hour, minute } = data;
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    const h = hour as number;
    const m = minute as number;
    return h >= 0 && h < 24 && m >= 0 && m < 60 ? { kind: 'daily', hour: h, minute: m } : null;
  }
  return null;
}

export function parseRoutineInput(raw: unknown): RoutineInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { name, prompt, projectPath, schedule } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || typeof prompt !== 'string' || typeof projectPath !== 'string') return null;
  const cleanName = name.trim();
  const cleanPrompt = prompt.trim();
  if (cleanName === '' || cleanName.length > ROUTINE_MAX_NAME) return null;
  if (cleanPrompt === '' || cleanPrompt.length > ROUTINE_MAX_PROMPT || !isAbsolute(projectPath)) return null;
  const parsed = parseSchedule(schedule);
  return parsed === null ? null : { name: cleanName, prompt: cleanPrompt, projectPath, schedule: parsed };
}

function parseRun(raw: unknown): Routine['history'] {
  if (typeof raw !== 'object' || raw === null) return [];
  const { at, outcome } = raw as Record<string, unknown>;
  const known = OUTCOMES.find((candidate) => candidate === outcome);
  return typeof at === 'number' && known !== undefined ? [{ at, outcome: known }] : [];
}

function parseSaved(raw: unknown): Routine | null {
  const input = parseRoutineInput(raw);
  if (input === null) return null;
  const { id, enabled, nextRunAt: next, history } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || typeof next !== 'number' || !Number.isFinite(next)) return null;
  return {
    ...input,
    id,
    enabled: enabled !== false,
    nextRunAt: next,
    history: Array.isArray(history) ? history.flatMap(parseRun).slice(0, HISTORY_LIMIT) : [],
  };
}

export class RoutineService {
  private routines: Routine[] = [];
  private running = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RoutineDeps) {}

  list(): readonly Routine[] {
    return this.routines;
  }

  restore(saved: readonly unknown[]): void {
    this.routines = saved.flatMap((entry) => parseSaved(entry) ?? []).slice(0, MAX_ROUTINES);
  }

  add(input: RoutineInput): Routine {
    if (this.routines.length >= MAX_ROUTINES) throw new RoutineLimitError();
    const routine: Routine = {
      ...input,
      id: this.deps.newId(),
      enabled: true,
      nextRunAt: nextRunAt(input.schedule, this.deps.now()),
      history: [],
    };
    this.routines = [...this.routines, routine];
    this.deps.onChange();
    return routine;
  }

  remove(id: string): boolean {
    const next = this.routines.filter((routine) => routine.id !== id);
    if (next.length === this.routines.length) return false;
    this.routines = next;
    this.deps.onChange();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    if (!this.routines.some((routine) => routine.id === id)) return false;
    // Resuming counts from now: a paused routine has no turns to make up.
    this.update(id, (routine) => ({
      ...routine,
      enabled,
      ...(enabled ? { nextRunAt: nextRunAt(routine.schedule, this.deps.now()) } : {}),
    }));
    return true;
  }

  async runNow(id: string): Promise<boolean> {
    const routine = this.routines.find((candidate) => candidate.id === id);
    if (routine === undefined) return false;
    await this.fire(routine.id);
    return true;
  }

  async tick(): Promise<void> {
    const now = this.deps.now();
    const due = this.routines.filter((routine) => routine.enabled && routine.nextRunAt <= now);
    await Promise.all(due.map((routine) => this.fire(routine.id)));
  }

  private update(id: string, change: (routine: Routine) => Routine): void {
    this.routines = this.routines.map((routine) => (routine.id === id ? change(routine) : routine));
    this.deps.onChange();
  }

  /** Takes its place in the line: a slow start must not let another routine see the same free terminal. */
  private fire(id: string): Promise<void> {
    if (this.running.has(id)) return Promise.resolve();
    this.running.add(id);
    const turn = this.queue.then(() => this.take(id)).finally(() => this.running.delete(id));
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async take(id: string): Promise<void> {
    const routine = this.routines.find((candidate) => candidate.id === id);
    if (routine === undefined) return;
    const outcome = await this.outcomeOf(routine);
    const at = this.deps.now();
    const retry = outcome === 'skipped-busy' || outcome === 'failed';
    this.update(id, (current) => ({
      ...current,
      nextRunAt: retry
        ? Math.min(at + RETRY_MINUTES * MINUTE_MS, nextRunAt(current.schedule, at))
        : nextRunAt(current.schedule, at),
      history: [{ at, outcome }, ...current.history].slice(0, HISTORY_LIMIT),
    }));
  }

  private async outcomeOf(routine: Routine): Promise<RoutineOutcome> {
    if (!this.deps.enabled()) return 'skipped-off';
    try {
      const terminals = this.deps.terminalsIn(routine.projectPath);
      const idle = terminals.find((terminal) => !terminal.busy);
      if (idle !== undefined) return this.deps.paste(idle.id, routine.prompt) ? 'sent' : 'failed';
      if (terminals.length > 0) return 'skipped-busy';
      await this.deps.start(routine.projectPath, routine.prompt);
      return 'started';
    } catch {
      return 'failed';
    }
  }
}
