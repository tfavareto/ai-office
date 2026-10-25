// Defensive reading of `progress.json`: every field is validated, anything unreadable is dropped, and a file written by
// a newer version is not touched. A progress file is only ever ours, but disks and editors misbehave.
import {
  MAX_DAY_WORKERS,
  PROGRESS_EVENTS,
  PROGRESS_VERSION,
  achievementDef,
  dayRange,
  emptyState,
  type AchievementId,
  type DayFacts,
  type DayWorker,
  type ProgressEventName,
  type ProgressRecords,
  type ProgressState,
  type ProgressSums,
  EMPTY_PROGRESS_SUMS,
} from '@ai-office/shared';
import { asRecord } from '../util/fs-safe';

const MAX_NUMBER = 1e13;
const MAX_NAME_LENGTH = 80;
const MAX_DAYS = 5000;

export type ParsedProgress =
  { status: 'ok'; state: ProgressState; dropped: number } | { status: 'newer-version' } | { status: 'unreadable' };

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_NUMBER
    ? Math.floor(value)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME_LENGTH ? value : undefined;
}

function worker(raw: unknown): DayWorker | undefined {
  const data = asRecord(raw);
  const name = text(data.name);
  const tasks = count(data.tasks);
  if (name === undefined || tasks === undefined) return undefined;
  return { name, project: typeof data.project === 'string' ? data.project.slice(0, MAX_NAME_LENGTH) : '', tasks };
}

function day(date: string, raw: unknown): DayFacts | undefined {
  const data = asRecord(raw);
  const numbers = {
    sessions: count(data.sessions),
    activeMs: count(data.activeMs),
    tasks: count(data.tasks),
    commits: count(data.commits),
    testsPassed: count(data.testsPassed),
    tokens: count(data.tokens),
    subagents: count(data.subagents),
    peakAgents: count(data.peakAgents),
  };
  if (Object.values(numbers).some((value) => value === undefined)) return undefined;
  const workers = (Array.isArray(data.workers) ? data.workers : [])
    .map(worker)
    .filter((entry): entry is DayWorker => entry !== undefined)
    .slice(0, MAX_DAY_WORKERS);
  return {
    date,
    ...(numbers as Record<keyof typeof numbers, number>),
    night: data.night === true,
    early: data.early === true,
    workers,
  };
}

function sums(raw: unknown): ProgressSums {
  const data = asRecord(raw);
  const result: ProgressSums = { ...EMPTY_PROGRESS_SUMS };
  for (const key of Object.keys(EMPTY_PROGRESS_SUMS) as (keyof ProgressSums)[]) result[key] = count(data[key]) ?? 0;
  return result;
}

function records(raw: unknown): ProgressRecords {
  const data = asRecord(raw);
  return {
    peakAgents: count(data.peakAgents) ?? 0,
    peakSubagents: count(data.peakSubagents) ?? 0,
    bestStreak: count(data.bestStreak) ?? 0,
    xp: count(data.xp) ?? 0,
  };
}

export function parseProgressFile(raw: unknown): ParsedProgress {
  const data = asRecord(raw);
  if (typeof data.version !== 'number') return { status: 'unreadable' };
  if (data.version > PROGRESS_VERSION) return { status: 'newer-version' };
  if (data.version !== PROGRESS_VERSION) return { status: 'unreadable' };
  let dropped = 0;
  const days: Record<string, DayFacts> = {};
  for (const [date, entry] of Object.entries(asRecord(data.days)).slice(0, MAX_DAYS)) {
    const facts = dayRange(date) === undefined ? undefined : day(date, entry);
    if (facts === undefined) dropped++;
    else days[date] = facts;
  }
  const unlocks: Partial<Record<AchievementId, number>> = {};
  for (const [id, at] of Object.entries(asRecord(data.unlocks))) {
    const def = achievementDef(id as AchievementId);
    const time = count(at);
    if (def === undefined || time === undefined) dropped++;
    else unlocks[def.id] = time;
  }
  const events: Partial<Record<ProgressEventName, number>> = {};
  for (const name of PROGRESS_EVENTS) {
    const at = count(asRecord(data.events)[name]);
    if (at !== undefined) events[name] = at;
  }
  const settled =
    typeof data.settledThrough === 'string' && dayRange(data.settledThrough) ? data.settledThrough : undefined;
  return {
    status: 'ok',
    dropped,
    state: {
      ...emptyState(),
      days,
      base: sums(data.base),
      records: records(data.records),
      unlocks,
      events,
      ...(settled !== undefined ? { settledThrough: settled } : {}),
    },
  };
}
