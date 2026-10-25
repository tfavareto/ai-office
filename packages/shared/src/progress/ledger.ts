// The progress ledger: the state the server persists and the pure operations on it. Every function returns a new
// state; nothing is mutated. A day is stored once (replacing it is idempotent), the level only ever rises, and an
// achievement keeps the date it was first earned.
import { addDays } from '../usage/periods';
import { dayRange, localDateKey } from '../report/range';
import { ACHIEVEMENTS, ACHIEVEMENT_IDS, reached } from './achievements';
import { levelOf, xpOf } from './levels';
import {
  MAX_RECENT_UNLOCKS,
  PROGRESS_VERSION,
  type AchievementId,
  type AchievementState,
  type Cumulative,
  type DayFacts,
  type EmployeeOfTheMonth,
  type Progress,
  type ProgressEventName,
  type ProgressStats,
  type ProgressSummary,
} from './types';

/** Days older than this are folded into {@link ProgressSums} so the file stays small however long the office lives. */
export const DETAILED_DAYS = 400;
const HOUR_MS = 3_600_000;

export interface ProgressSums {
  sessions: number;
  activeMs: number;
  tasks: number;
  commits: number;
  testsPassed: number;
  tokens: number;
  subagents: number;
  daysActive: number;
  nightDays: number;
  earlyDays: number;
  weekendDays: number;
}

export interface ProgressRecords {
  peakAgents: number;
  peakSubagents: number;
  bestStreak: number;
  /** The highest XP ever reached: the level is derived from it, so it never goes down. */
  xp: number;
}

export interface ProgressState {
  version: typeof PROGRESS_VERSION;
  days: Readonly<Record<string, DayFacts>>;
  base: ProgressSums;
  records: ProgressRecords;
  unlocks: Readonly<Partial<Record<AchievementId, number>>>;
  events: Readonly<Partial<Record<ProgressEventName, number>>>;
  /** Days up to this one (inclusive) are final: the service does not read them again. */
  settledThrough?: string;
}

export const EMPTY_PROGRESS_SUMS: ProgressSums = {
  sessions: 0,
  activeMs: 0,
  tasks: 0,
  commits: 0,
  testsPassed: 0,
  tokens: 0,
  subagents: 0,
  daysActive: 0,
  nightDays: 0,
  earlyDays: 0,
  weekendDays: 0,
};

export function emptyState(): ProgressState {
  return {
    version: PROGRESS_VERSION,
    days: {},
    base: EMPTY_PROGRESS_SUMS,
    records: { peakAgents: 0, peakSubagents: 0, bestStreak: 0, xp: 0 },
    unlocks: {},
    events: {},
  };
}

function isWeekend(date: string): boolean {
  const range = dayRange(date);
  if (range === undefined) return false;
  const day = new Date(range.start).getDay();
  return day === 0 || day === 6;
}

function addFacts(sums: ProgressSums, facts: DayFacts): ProgressSums {
  return {
    sessions: sums.sessions + facts.sessions,
    activeMs: sums.activeMs + facts.activeMs,
    tasks: sums.tasks + facts.tasks,
    commits: sums.commits + facts.commits,
    testsPassed: sums.testsPassed + facts.testsPassed,
    tokens: sums.tokens + facts.tokens,
    subagents: sums.subagents + facts.subagents,
    daysActive: sums.daysActive + 1,
    nightDays: sums.nightDays + (facts.night ? 1 : 0),
    earlyDays: sums.earlyDays + (facts.early ? 1 : 0),
    weekendDays: sums.weekendDays + (isWeekend(facts.date) ? 1 : 0),
  };
}

function sortedDates(days: Readonly<Record<string, DayFacts>>): string[] {
  return Object.keys(days).sort();
}

/** The date after `date`, or undefined when it is not a real date. */
function nextDate(date: string): string | undefined {
  const range = dayRange(date);
  return range === undefined ? undefined : localDateKey(addDays(range.start, 1));
}

/** Length of every run of consecutive dates (input sorted ascending), in order. */
function runs(dates: readonly string[]): { end: string; length: number }[] {
  const result: { end: string; length: number }[] = [];
  for (const date of dates) {
    const last = result[result.length - 1];
    if (last !== undefined && nextDate(last.end) === date)
      result[result.length - 1] = { end: date, length: last.length + 1 };
    else result.push({ end: date, length: 1 });
  }
  return result;
}

/**
 * The streak that is still alive: it counts through today, or through yesterday while today has not started yet
 * (the day is not over, so it is not broken).
 */
export function currentStreak(dates: readonly string[], todayKey: string): number {
  const last = runs([...dates].sort()).pop();
  if (last === undefined) return 0;
  const yesterday = localDateKey(addDays(dayRange(todayKey)?.start ?? 0, -1));
  return last.end === todayKey || last.end === yesterday ? last.length : 0;
}

export function bestStreakOf(dates: readonly string[]): number {
  return runs([...dates].sort()).reduce((best, run) => Math.max(best, run.length), 0);
}

function foldOld(state: ProgressState, now: number): ProgressState {
  const cutoff = localDateKey(addDays(dayRange(localDateKey(now))?.start ?? now, -DETAILED_DAYS));
  const old = sortedDates(state.days).filter((date) => date < cutoff);
  if (old.length === 0) return state;
  const days = { ...state.days };
  let base = state.base;
  for (const date of old) {
    base = addFacts(base, days[date]);
    delete days[date];
  }
  return { ...state, days, base };
}

/** The state with the day's facts in place of any earlier ones for the same date. */
export function withDay(state: ProgressState, facts: DayFacts, now: number): ProgressState {
  const records: ProgressRecords = {
    ...state.records,
    peakAgents: Math.max(state.records.peakAgents, facts.peakAgents),
    peakSubagents: Math.max(state.records.peakSubagents, facts.subagents),
  };
  return foldOld({ ...state, days: { ...state.days, [facts.date]: facts }, records }, now);
}

/** The state with days up to `date` marked final. */
export function withSettled(state: ProgressState, date: string): ProgressState {
  return state.settledThrough !== undefined && state.settledThrough >= date
    ? state
    : { ...state, settledThrough: date };
}

export function withPeakAgents(state: ProgressState, agents: number): ProgressState {
  return agents <= state.records.peakAgents ? state : { ...state, records: { ...state.records, peakAgents: agents } };
}

/** The first time the page does something counts; later ones change nothing. */
export function withEvent(state: ProgressState, event: ProgressEventName, now: number): ProgressState {
  return state.events[event] !== undefined ? state : { ...state, events: { ...state.events, [event]: now } };
}

function sumsOf(state: ProgressState): ProgressSums {
  return Object.values(state.days).reduce(addFacts, state.base);
}

export function cumulativeOf(state: ProgressState): Cumulative {
  const sums = sumsOf(state);
  const days = Object.values(state.days);
  return {
    sessions: sums.sessions,
    activeHours: Math.floor(sums.activeMs / HOUR_MS),
    tasks: sums.tasks,
    commits: sums.commits,
    testsPassed: sums.testsPassed,
    tokens: sums.tokens,
    subagents: sums.subagents,
    daysActive: sums.daysActive,
    bestStreak: Math.max(state.records.bestStreak, bestStreakOf(sortedDates(state.days))),
    peakAgents: Math.max(state.records.peakAgents, ...days.map((day) => day.peakAgents)),
    peakSubagents: Math.max(state.records.peakSubagents, ...days.map((day) => day.subagents)),
    nightDays: sums.nightDays,
    earlyDays: sums.earlyDays,
    weekendDays: sums.weekendDays,
    timelapseSeen: state.events.timelapse === undefined ? 0 : 1,
    shareSeen: state.events.share === undefined ? 0 : 1,
  };
}

/** For each achievement the first day on which replaying the days in order reaches it (a day-level approximation). */
function firstReachedDates(state: ProgressState): Map<AchievementId, string> {
  const found = new Map<AchievementId, string>();
  let sums: ProgressSums = state.base;
  let streak = 0;
  let best = 0;
  let previous: string | undefined;
  let peakAgents = 0;
  let peakSubagents = 0;
  for (const date of sortedDates(state.days)) {
    const facts = state.days[date];
    sums = addFacts(sums, facts);
    streak = previous !== undefined && nextDate(previous) === date ? streak + 1 : 1;
    best = Math.max(best, streak);
    previous = date;
    peakAgents = Math.max(peakAgents, facts.peakAgents);
    peakSubagents = Math.max(peakSubagents, facts.subagents);
    const cumulative: Cumulative = {
      sessions: sums.sessions,
      activeHours: Math.floor(sums.activeMs / HOUR_MS),
      tasks: sums.tasks,
      commits: sums.commits,
      testsPassed: sums.testsPassed,
      tokens: sums.tokens,
      subagents: sums.subagents,
      daysActive: sums.daysActive,
      bestStreak: best,
      peakAgents,
      peakSubagents,
      nightDays: sums.nightDays,
      earlyDays: sums.earlyDays,
      weekendDays: sums.weekendDays,
      timelapseSeen: 0,
      shareSeen: 0,
    };
    for (const id of reached(cumulative)) if (!found.has(id)) found.set(id, date);
  }
  return found;
}

export interface Settled {
  state: ProgressState;
  /** Achievements earned by this settling, for the caller to announce. */
  unlocked: AchievementId[];
}

/**
 * ProgressRecords new unlocks (dated to the day they were reached when the history shows it, else `now`) and raises the
 * high-water marks of the best streak and the XP.
 */
export function settle(state: ProgressState, now: number): Settled {
  const cumulative = cumulativeOf(state);
  const dates = firstReachedDates(state);
  const unlocks: Partial<Record<AchievementId, number>> = { ...state.unlocks };
  const unlocked: AchievementId[] = [];
  for (const id of reached(cumulative)) {
    if (unlocks[id] !== undefined) continue;
    const def = ACHIEVEMENTS.find((candidate) => candidate.id === id);
    const eventAt =
      def?.metric === 'timelapseSeen'
        ? state.events.timelapse
        : def?.metric === 'shareSeen'
          ? state.events.share
          : undefined;
    const date = dates.get(id);
    const dayEnd = date === undefined ? undefined : (dayRange(date)?.end ?? now) - 1;
    unlocks[id] = Math.min(now, eventAt ?? dayEnd ?? now);
    unlocked.push(id);
  }
  const xp = Math.max(state.records.xp, xpOf(cumulative, Object.keys(unlocks).length));
  return {
    state: { ...state, unlocks, records: { ...state.records, bestStreak: cumulative.bestStreak, xp } },
    unlocked,
  };
}

/** The agent with the most completed tasks in the month `monthKey` (YYYY-MM), and the project where they did most. */
export function employeeOfTheMonth(
  days: Readonly<Record<string, DayFacts>>,
  monthKey: string,
): EmployeeOfTheMonth | undefined {
  const byName = new Map<string, { tasks: number; projects: Map<string, number> }>();
  for (const [date, facts] of Object.entries(days)) {
    if (!date.startsWith(monthKey)) continue;
    for (const worker of facts.workers) {
      const entry = byName.get(worker.name) ?? { tasks: 0, projects: new Map<string, number>() };
      entry.tasks += worker.tasks;
      entry.projects.set(worker.project, (entry.projects.get(worker.project) ?? 0) + worker.tasks);
      byName.set(worker.name, entry);
    }
  }
  let winner: { name: string; tasks: number; project: string } | undefined;
  for (const [name, entry] of byName) {
    if (winner !== undefined && (entry.tasks < winner.tasks || (entry.tasks === winner.tasks && name > winner.name)))
      continue;
    const project = [...entry.projects].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '';
    winner = { name, tasks: entry.tasks, project };
  }
  return winner;
}

export interface BuildOptions {
  now: number;
  /** Include the project of the employee of the month (the page asks for it when the user opted in). */
  includeProject: boolean;
  /** The history is still being read. */
  counting: boolean;
}

function statsOf(state: ProgressState, cumulative: Cumulative, now: number): ProgressStats {
  const sums = sumsOf(state);
  return {
    sessions: sums.sessions,
    activeMs: sums.activeMs,
    tasks: sums.tasks,
    commits: sums.commits,
    testsPassed: sums.testsPassed,
    tokens: sums.tokens,
    subagents: sums.subagents,
    daysActive: sums.daysActive,
    currentStreak: currentStreak(sortedDates(state.days), localDateKey(now)),
    bestStreak: cumulative.bestStreak,
    peakAgents: cumulative.peakAgents,
  };
}

export function achievementStates(state: ProgressState, cumulative: Cumulative): AchievementState[] {
  return ACHIEVEMENTS.map((def) => ({
    id: def.id,
    tier: def.tier,
    ...(state.unlocks[def.id] !== undefined ? { unlockedAt: state.unlocks[def.id] } : {}),
    value: Math.min(def.target, cumulative[def.metric]),
    target: def.target,
  }));
}

/** The XP the state stands at (the high-water mark, or the current figures when they are higher). */
export function xpNow(state: ProgressState): number {
  return Math.max(state.records.xp, xpOf(cumulativeOf(state), Object.keys(state.unlocks).length));
}

export function buildProgress(state: ProgressState, options: BuildOptions): Progress {
  const cumulative = cumulativeOf(state);
  const employee = employeeOfTheMonth(state.days, localDateKey(options.now).slice(0, 7));
  const first = sortedDates(state.days)[0];
  return {
    level: levelOf(xpNow(state)),
    stats: statsOf(state, cumulative, options.now),
    achievements: achievementStates(state, cumulative),
    ...(employee !== undefined
      ? { employee: options.includeProject ? employee : { name: employee.name, tasks: employee.tasks } }
      : {}),
    ...(first !== undefined ? { since: first } : {}),
    ...(options.counting ? { counting: true } : {}),
  };
}

export function buildSummary(state: ProgressState, now: number): ProgressSummary {
  const level = levelOf(xpNow(state));
  const employee = employeeOfTheMonth(state.days, localDateKey(now).slice(0, 7));
  const recent = ACHIEVEMENT_IDS.filter((id) => state.unlocks[id] !== undefined)
    .map((id) => ({ id, at: state.unlocks[id] as number }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_RECENT_UNLOCKS);
  return {
    level: level.level,
    xp: level.xp,
    from: level.from,
    to: level.to,
    achievements: Object.keys(state.unlocks).length,
    total: ACHIEVEMENTS.length,
    recent,
    ...(employee !== undefined ? { employee: employee.name } : {}),
  };
}
