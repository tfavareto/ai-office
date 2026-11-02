// Defensive parsing of GET /api/routines, GET /api/terminals/resumable and the note of a room: anything malformed is dropped.
import { NOTE_MAX_CHARS, type ProjectNote } from '@ai-office/shared';
import {
  ROUTINE_MAX_NAME,
  ROUTINE_MAX_PROMPT,
  type Routine,
  type RoutineOutcome,
  type RoutineSchedule,
} from '@ai-office/shared';
import { isRecord } from './parse';

const OUTCOMES: readonly RoutineOutcome[] = ['sent', 'started', 'skipped-busy', 'skipped-off', 'failed'];

export interface ResumableTerminal {
  sessionId: string;
  cwd: string;
  role?: string;
}

function parseSchedule(raw: unknown): RoutineSchedule | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'interval' && typeof raw.minutes === 'number') return { kind: 'interval', minutes: raw.minutes };
  if (raw.kind === 'daily' && typeof raw.hour === 'number' && typeof raw.minute === 'number')
    return { kind: 'daily', hour: raw.hour, minute: raw.minute };
  return null;
}

function parseRun(raw: unknown): Routine['history'] {
  if (!isRecord(raw) || typeof raw.at !== 'number') return [];
  const outcome = OUTCOMES.find((known) => known === raw.outcome);
  return outcome === undefined ? [] : [{ at: raw.at, outcome }];
}

function parseRoutine(raw: unknown): Routine[] {
  if (!isRecord(raw)) return [];
  const { id, name, prompt, projectPath, enabled, nextRunAt, history } = raw;
  const schedule = parseSchedule(raw.schedule);
  if (typeof id !== 'string' || typeof name !== 'string' || typeof prompt !== 'string') return [];
  if (typeof projectPath !== 'string' || typeof nextRunAt !== 'number' || schedule === null) return [];
  return [
    {
      id,
      name: name.slice(0, ROUTINE_MAX_NAME),
      prompt: prompt.slice(0, ROUTINE_MAX_PROMPT),
      projectPath,
      schedule,
      enabled: enabled === true,
      nextRunAt,
      history: Array.isArray(history) ? history.flatMap(parseRun) : [],
    },
  ];
}

export function parseNote(data: unknown): ProjectNote {
  if (!isRecord(data) || typeof data.text !== 'string' || typeof data.updatedAt !== 'number')
    return { text: '', updatedAt: 0 };
  return { text: data.text.slice(0, NOTE_MAX_CHARS), updatedAt: data.updatedAt };
}

export function parseRoutines(data: unknown): Routine[] {
  return isRecord(data) && Array.isArray(data.routines) ? data.routines.flatMap(parseRoutine) : [];
}

export function parseResumableTerminals(data: unknown): ResumableTerminal[] {
  if (!isRecord(data) || !Array.isArray(data.sessions)) return [];
  return data.sessions.flatMap((raw: unknown): ResumableTerminal[] => {
    if (!isRecord(raw) || typeof raw.sessionId !== 'string' || typeof raw.cwd !== 'string') return [];
    return [{ sessionId: raw.sessionId, cwd: raw.cwd, ...(typeof raw.role === 'string' ? { role: raw.role } : {}) }];
  });
}
