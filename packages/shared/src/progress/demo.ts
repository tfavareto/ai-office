// Believable progress for the demo and `?mock=1`: about six weeks of work, level 6, a good part of the badges, and an
// employee of the month taken from the demo's own people. Deterministic: the same input gives the same office.
import { addDays, startOfDay } from '../usage/periods';
import { localDateKey } from '../report/range';
import { dayFacts } from './fixtures';
import { LEVEL_THRESHOLDS, MAX_LEVEL, levelOf } from './levels';
import {
  buildProgress,
  buildSummary,
  emptyState,
  settle,
  withDay,
  withEvent,
  withPeakAgents,
  type ProgressState,
} from './ledger';
import type { DayFacts, Progress, ProgressSummary } from './types';

const HISTORY_DAYS = 30;
const HOUR = 3_600_000;
const FALLBACK_NAMES = ['Heloísa', 'Diego', 'Priscila', 'Theo'];
const FALLBACK_PROJECTS = ['app-mobile', 'loja-online', 'api-pagamentos'];

export interface DemoProgressInput {
  now: number;
  /** The demo office's people, the first one is the busiest. */
  agentNames?: readonly string[];
  projectNames?: readonly string[];
  /** Pins the level (previews of the unlockable decoration); default: the level the history reaches. */
  level?: number;
}

function demoDay(index: number, date: string, names: readonly string[], projects: readonly string[]): DayFacts {
  const tasks = 5 + ((index * 7) % 9);
  const workers = names.slice(0, 4).map((name, slot) => ({
    name,
    project: projects[(index + slot) % projects.length],
    tasks: Math.max(1, Math.round((tasks * (4 - slot)) / 10)),
  }));
  return dayFacts(date, {
    sessions: 3 + (index % 4),
    activeMs: (3 + (index % 3)) * HOUR + 20 * 60_000,
    tasks,
    commits: 1 + (index % 4),
    testsPassed: 3 + ((index * 3) % 7),
    tokens: 6_000_000 + (index % 5) * 2_500_000,
    subagents: index % 6,
    peakAgents: 2 + (index % 4),
    night: index % 11 === 0,
    early: index % 9 === 4,
    workers,
  });
}

export function demoProgressState(input: DemoProgressInput): ProgressState {
  const names = input.agentNames !== undefined && input.agentNames.length > 0 ? input.agentNames : FALLBACK_NAMES;
  const projects =
    input.projectNames !== undefined && input.projectNames.length > 0 ? input.projectNames : FALLBACK_PROJECTS;
  const today = startOfDay(input.now);
  let state = emptyState();
  for (let back = HISTORY_DAYS; back >= 0; back--) {
    const day = addDays(today, -back);
    const weekday = new Date(day).getDay();
    if ((weekday === 0 || weekday === 6) && back % 7 !== 3) continue;
    state = withDay(state, demoDay(back, localDateKey(day), names, projects), input.now);
  }
  state = withEvent(
    withEvent(withPeakAgents(state, 5), 'timelapse', input.now - 20 * 86_400_000),
    'share',
    input.now - 9 * 86_400_000,
  );
  const settled = settle(state, input.now).state;
  return settled;
}

export function demoProgress(input: DemoProgressInput): { progress: Progress; summary: ProgressSummary } {
  const state = demoProgressState(input);
  const progress = buildProgress(state, { now: input.now, includeProject: true, counting: false });
  const summary = buildSummary(state, input.now);
  if (input.level === undefined) return { progress: { ...progress, demo: true }, summary: { ...summary, demo: true } };
  const pinned = levelOf(LEVEL_THRESHOLDS[Math.min(MAX_LEVEL, Math.max(1, Math.round(input.level))) - 1] + 10);
  return {
    progress: { ...progress, level: pinned, demo: true },
    summary: { ...summary, level: pinned.level, xp: pinned.xp, from: pinned.from, to: pinned.to, demo: true },
  };
}
