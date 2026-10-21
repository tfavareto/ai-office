// View model of the day report: sections (by project or by agent), the numbers that head them, the timeline strip,
// the highlights ("Ana closed 4 tasks and made 3 commits in loja-online") and the small helpers both the dialog and the
// Markdown export share.
import {
  REPORT_BUCKETS,
  REPORT_BUCKET_MS,
  REPORT_TOOL_KINDS,
  type DayReport,
  type ReportAgent,
  type ReportProject,
  type ReportTestRun,
  type ReportToolKind,
  type ReportTotals,
  agentTotals,
  projectTotals,
} from '@ai-office/shared';
import { t, type UiKey } from '../../i18n';
import { formatCost, formatDuration, formatShare } from '../format';

export type ReportGroupBy = 'project' | 'agent';

const MAX_HIGHLIGHTS = 5;
const MIN_FILES_HIGHLIGHT = 3;
const MIN_SPEND_SHARE = 0.4;

export interface ReportEntry {
  agent: ReportAgent;
  projectName: string;
  totals: ReportTotals;
}

export interface ReportSection {
  id: string;
  title: string;
  /** The project's name when the section is an agent. */
  subtitle?: string;
  totals: ReportTotals;
  entries: ReportEntry[];
  /** Active ms per half hour, all entries together. */
  activity: number[];
}

export function projectLabel(project: Pick<ReportProject, 'name'>): string {
  return project.name.length > 0 ? project.name : t('report.unknownProject');
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Work time: people work in parallel, so a day's total can pass 24 hours; it stays in hours ("26 h 05 min"). */
export function formatWorkTime(ms: number): string {
  if (ms < DAY_MS) return formatDuration(ms);
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / 60_000);
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

export function reportFilename(date: string): string {
  return `ai-office-${date}.md`;
}

/** Sum of the half-hour buckets of several agents. */
export function sumActivity(agents: readonly ReportAgent[]): number[] {
  return Array.from({ length: REPORT_BUCKETS }, (_, i) => agents.reduce((sum, agent) => sum + (agent.activity[i] ?? 0), 0));
}

/** How busy a half hour was, 0..1 (a full half hour of one agent at work is 1). */
export function intensity(ms: number): number {
  return Math.max(0, Math.min(1, ms / REPORT_BUCKET_MS));
}

function entriesOf(project: ReportProject): ReportEntry[] {
  return project.agents.map((agent) => ({ agent, projectName: projectLabel(project), totals: agentTotals(agent) }));
}

export function reportSections(report: Pick<DayReport, 'projects'>, groupBy: ReportGroupBy): ReportSection[] {
  if (groupBy === 'project') {
    return report.projects.map((project) => ({ id: project.id, title: projectLabel(project), totals: projectTotals(project), entries: entriesOf(project), activity: sumActivity(project.agents) }));
  }
  return report.projects
    .flatMap(entriesOf)
    .sort((a, b) => b.agent.activeMs - a.agent.activeMs || a.agent.name.localeCompare(b.agent.name))
    .map((entry) => ({ id: entry.agent.agentId, title: entry.agent.name, subtitle: entry.projectName, totals: entry.totals, entries: [entry], activity: sumActivity([entry.agent]) }));
}

// ---- smaller pieces -----------------------------------------------------------------------------------------------

const TOOL_LABELS: Readonly<Record<ReportToolKind, UiKey>> = {
  read: 'report.tool.read',
  search: 'report.tool.search',
  edit: 'report.tool.edit',
  write: 'report.tool.write',
  bash: 'report.tool.bash',
  web: 'report.tool.web',
  task: 'report.tool.task',
  subagent: 'report.tool.subagent',
  mcp: 'report.tool.mcp',
  question: 'report.tool.question',
  other: 'report.tool.other',
};

export function toolLabel(kind: ReportToolKind): string {
  return t(TOOL_LABELS[kind]);
}

/** Tool calls of an agent, most used first. */
export function toolSummary(agent: Pick<ReportAgent, 'toolCalls'>): { kind: ReportToolKind; count: number }[] {
  return REPORT_TOOL_KINDS.map((kind) => ({ kind, count: agent.toolCalls[kind] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

export interface RunnerSummary {
  runner: string;
  passed: number;
  failed: number;
  unknown: number;
}

/** Test runs grouped by runner, in order of first use. */
export function testsByRunner(tests: readonly ReportTestRun[]): RunnerSummary[] {
  const byRunner = new Map<string, RunnerSummary>();
  for (const run of tests) {
    const known = byRunner.get(run.runner) ?? { runner: run.runner, passed: 0, failed: 0, unknown: 0 };
    byRunner.set(run.runner, { ...known, [run.outcome]: known[run.outcome] + 1 });
  }
  return [...byRunner.values()];
}

// ---- highlights ---------------------------------------------------------------------------------------------------

interface Candidate {
  score: number;
  text: string;
}

const SCORE_TASK = 3;
const SCORE_COMMIT = 3;
const SCORE_TEST_RUN = 1;
const SCORE_FILE = 0.5;

function agentHighlight(entry: ReportEntry): Candidate | undefined {
  const { name } = entry.agent;
  const { tasks, commits, files, testsPassed, testsFailed, linesAdded, linesRemoved } = entry.totals;
  const project = entry.projectName;
  const runs = testsPassed + testsFailed;
  const score = tasks * SCORE_TASK + commits * SCORE_COMMIT + runs * SCORE_TEST_RUN + files * SCORE_FILE;
  if (tasks > 0 && commits > 0) return { score, text: t('report.highlight.tasksCommits', { name, tasks, commits, project }) };
  if (tasks > 0) return { score, text: t('report.highlight.tasks', { name, tasks, project }) };
  if (commits > 0) return { score, text: t('report.highlight.commits', { name, commits, project }) };
  if (runs > 0) return { score, text: testsFailed > 0 ? t('report.highlight.testsMixed', { name, runs, project, failed: testsFailed }) : t('report.highlight.testsPassed', { name, runs, project }) };
  if (files >= MIN_FILES_HIGHLIGHT) return { score, text: t('report.highlight.files', { name, files, project, added: linesAdded, removed: linesRemoved }) };
  return undefined;
}

/** Sentences about the day, most notable first: failing tests, what each person got done, who spent the most. */
export function reportHighlights(report: Pick<DayReport, 'projects'>): string[] {
  const lines: string[] = [];
  for (const project of report.projects) {
    const failed = projectTotals(project).testsFailed;
    if (failed > 0) lines.push(t('report.highlight.testsFailed', { runs: failed, project: projectLabel(project) }));
  }
  const entries = report.projects.flatMap(entriesOf);
  const people = entries.map(agentHighlight).filter((item): item is Candidate => item !== undefined).sort((a, b) => b.score - a.score);
  lines.push(...people.map((item) => item.text));
  const spend = spendHighlight(entries);
  if (spend !== undefined) lines.push(spend);
  return lines.slice(0, MAX_HIGHLIGHTS);
}

function spendHighlight(entries: readonly ReportEntry[]): string | undefined {
  const total = entries.reduce((sum, entry) => sum + entry.agent.usage.costUSD, 0);
  const top = [...entries].sort((a, b) => b.agent.usage.costUSD - a.agent.usage.costUSD)[0];
  if (top === undefined || entries.length < 2 || total <= 0 || top.agent.usage.costUSD / total < MIN_SPEND_SHARE) return undefined;
  return t('report.highlight.spend', { name: top.agent.name, share: formatShare(top.agent.usage.costUSD / total), cost: formatCost(top.agent.usage.costUSD) });
}
