// What one finished day contributes to the progress, taken from the day report. Pure.
import { projectCommits } from '../report/totals';
import { REPORT_BUCKETS, REPORT_BUCKET_MS, type DayReport, type ReportAgent } from '../report/types';
import { MAX_DAY_WORKERS, type DayFacts, type DayWorker } from './types';

const BUCKET_MINUTES = REPORT_BUCKET_MS / 60_000;
/** Half hours 0-9 are 00:00-05:00 and 10-13 are 05:00-07:00. */
const NIGHT_BUCKETS = (5 * 60) / BUCKET_MINUTES;
const EARLY_BUCKETS_END = (7 * 60) / BUCKET_MINUTES;
/** A blip shorter than this does not make someone a night owl or an early bird, nor count as an agent at work. */
const MIN_PRESENCE_MS = 120_000;
const MIN_BUCKET_MS = 30_000;

function activeIn(agent: ReportAgent, from: number, to: number): number {
  let ms = 0;
  for (let i = from; i < to; i++) ms += agent.activity[i] ?? 0;
  return ms;
}

function peakAgents(agents: readonly ReportAgent[]): number {
  let peak = 0;
  for (let bucket = 0; bucket < REPORT_BUCKETS; bucket++) {
    const working = agents.filter((agent) => (agent.activity[bucket] ?? 0) >= MIN_BUCKET_MS).length;
    peak = Math.max(peak, working);
  }
  return peak;
}

function workersOf(report: Pick<DayReport, 'projects'>): DayWorker[] {
  const found = new Map<string, DayWorker>();
  for (const project of report.projects) {
    for (const agent of project.agents) {
      if (agent.tasks.length === 0) continue;
      const key = `${agent.name}|${project.name}`;
      const known = found.get(key);
      found.set(key, {
        name: agent.name,
        project: project.name,
        tasks: (known?.tasks ?? 0) + agent.tasks.length,
      });
    }
  }
  return [...found.values()]
    .sort((a, b) => b.tasks - a.tasks || a.name.localeCompare(b.name))
    .slice(0, MAX_DAY_WORKERS);
}

/** The facts of a day, or undefined for a day nobody worked (it is not stored). */
export function factsFromReport(report: DayReport): DayFacts | undefined {
  const agents = report.projects.flatMap((project) => project.agents);
  if (agents.length === 0) return undefined;
  return {
    date: report.date,
    sessions: agents.length,
    activeMs: agents.reduce((sum, agent) => sum + agent.activeMs, 0),
    tasks: agents.reduce((sum, agent) => sum + agent.tasks.length, 0),
    commits: report.projects.reduce((sum, project) => sum + projectCommits(project).length, 0),
    testsPassed: agents.reduce((sum, agent) => sum + agent.tests.filter((run) => run.outcome === 'passed').length, 0),
    tokens: agents.reduce((sum, agent) => sum + agent.usage.tokens, 0),
    subagents: agents.reduce((sum, agent) => sum + agent.subagents.count, 0),
    peakAgents: peakAgents(agents),
    night: agents.some((agent) => activeIn(agent, 0, NIGHT_BUCKETS) >= MIN_PRESENCE_MS),
    early: agents.some((agent) => activeIn(agent, NIGHT_BUCKETS, EARLY_BUCKETS_END) >= MIN_PRESENCE_MS),
    workers: workersOf(report),
  };
}
