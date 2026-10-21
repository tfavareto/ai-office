// Believable day reports for demo mode (server `AI_OFFICE_DEMO=1` and the page's `?mock=1`): the demo office's people
// worked on their projects today and on the days before. Deterministic for a date, an agent and a language.
import type { Agent } from '../model';
import { fnv1a, mulberry32 } from '../hash';
import { type Locale, msg, translateShared } from '../i18n';
import type { SharedMessageKey } from '../i18n/messages/pt-BR';
import { type DayRange } from '../report/range';
import {
  REPORT_BUCKETS,
  REPORT_BUCKET_MS,
  type DayReport,
  type ReportAgent,
  type ReportCommand,
  type ReportCommit,
  type ReportFileChange,
  type ReportProject,
  type ReportTask,
  type ReportTestRun,
  type ReportToolKind,
} from '../report/types';
import { HOUR_MS } from '../usage/periods';
import { type UsageRow, rowTokens } from '../usage/types';
import { DEMO_PROJECTS } from './content';

const MIN = 60_000;
const COMMIT_KEYS = 8;
/** Before this much of today has passed, the shifts are squeezed into the time there is. */
const MIN_FULL_DAY_MS = 7 * HOUR_MS;
const MIN_SHIFT_MS = 3 * MIN;
const TASK_KEYS = 10;
/** About how much of the work day a person spends in each shift. */
const TOKENS_PER_ACTIVE_MINUTE = 4200;
const USD_PER_TOKEN = 0.000011;

export interface DemoReportInput {
  range: DayRange;
  now: number;
  locale: Locale;
  agents: readonly Agent[];
  /** The demo's hourly usage rows; sessions without rows get believable numbers. */
  usageRows: readonly UsageRow[];
  account: string;
  includeRequests: boolean;
}

type Rng = () => number;
const between = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

function text(locale: Locale, key: SharedMessageKey): string {
  return translateShared(locale, msg(key));
}

export interface Shift {
  from: number;
  to: number;
}

/** Working hours of the day: two shifts, the last one ending now when the day is today. */
function shifts(range: DayRange, now: number, rng: Rng): Shift[] {
  const jitter = (): number => between(rng, 0, 80) * MIN;
  const elapsed = now - range.start;
  const early = now < range.end && elapsed < MIN_FULL_DAY_MS;
  const raw: Shift[] = early
    ? [
        { from: range.start + elapsed * 0.08, to: range.start + elapsed * 0.45 },
        { from: range.start + elapsed * 0.55, to: now - elapsed * 0.02 },
      ]
    : now < range.end
      ? [
          { from: now - between(rng, 330, 390) * MIN, to: now - between(rng, 190, 230) * MIN },
          { from: now - between(rng, 150, 190) * MIN, to: now - between(rng, 0, 12) * MIN },
        ]
      : [
          { from: range.start + 9 * HOUR_MS + jitter(), to: range.start + 12 * HOUR_MS + jitter() },
          { from: range.start + 13.5 * HOUR_MS + jitter(), to: range.start + 17 * HOUR_MS + jitter() },
        ];
  return raw
    .map((shift) => ({ from: Math.max(range.start, shift.from), to: Math.min(range.end - 1, now, shift.to) }))
    .filter((shift) => shift.to - shift.from >= MIN_SHIFT_MS);
}

function activityOf(range: DayRange, plan: readonly Shift[], rng: Rng): number[] {
  const buckets = new Array<number>(REPORT_BUCKETS).fill(0);
  for (let i = 0; i < REPORT_BUCKETS; i++) {
    const from = range.start + i * REPORT_BUCKET_MS;
    const overlap = plan.reduce(
      (sum, shift) => sum + Math.max(0, Math.min(shift.to, from + REPORT_BUCKET_MS) - Math.max(shift.from, from)),
      0,
    );
    buckets[i] = Math.round(overlap * (0.55 + rng() * 0.4));
  }
  return buckets;
}

function toolCalls(rng: Rng, scale: number): Partial<Record<ReportToolKind, number>> {
  const count = (min: number, max: number): number => Math.round(between(rng, min, max) * scale);
  return {
    read: count(20, 60),
    search: count(8, 25),
    edit: count(10, 35),
    write: count(2, 8),
    bash: count(10, 30),
    web: count(0, 5),
    task: count(2, 6),
    subagent: count(0, 3),
    mcp: count(0, 4),
    question: count(0, 2),
  };
}

function filesOf(rng: Rng, project: string, scale: number): ReportFileChange[] {
  const spec = DEMO_PROJECTS.find((candidate) => candidate.path === project);
  const files = (spec?.files ?? []).map((file) => file.slice(project.length + 1));
  const count = Math.min(files.length, Math.max(2, Math.round(between(rng, 3, 6) * scale)));
  return files
    .slice(0, count)
    .map((path) => ({ path, edits: between(rng, 1, 6), added: between(rng, 4, 90), removed: between(rng, 0, 40) }));
}

function commandsOf(rng: Rng, project: string): ReportCommand[] {
  const python = project.endsWith('pipeline-dados');
  const pool = python
    ? ['pytest -q', 'python -m ruff check .', 'git status', 'git diff --stat', 'python dags/ingestao.py --dry-run']
    : ['npm test', 'npm run build', 'npm run lint', 'git status', 'git diff --stat', 'npx tsc --noEmit'];
  return pool.slice(0, between(rng, 3, pool.length)).map((command) => ({ command, runs: between(rng, 1, 9) }));
}

function testsOf(rng: Rng, project: string, at: Shift): ReportTestRun[] {
  const runner = project.endsWith('pipeline-dados')
    ? 'pytest'
    : project.endsWith('api-pagamentos')
      ? 'vitest'
      : 'npm test';
  const count = between(rng, 2, 5);
  const failing = rng() < 0.35 ? between(rng, 0, count - 1) : -1;
  return Array.from({ length: count }, (_, i): ReportTestRun => {
    const when = at.from + Math.round(((i + 1) / (count + 1)) * (at.to - at.from));
    return i === failing
      ? { runner, at: when, outcome: 'failed', passed: between(rng, 20, 60), failed: between(rng, 1, 3) }
      : { runner, at: when, outcome: 'passed', passed: between(rng, 20, 70) };
  });
}

function commitsOf(rng: Rng, key: string, plan: Shift[], locale: Locale): ReportCommit[] {
  const count = rng() < 0.25 ? 0 : between(rng, 1, 4);
  const first = between(rng, 1, COMMIT_KEYS);
  const last = plan[plan.length - 1] as Shift;
  return Array.from({ length: count }, (_, i): ReportCommit => {
    const index = ((first + i * 3) % COMMIT_KEYS) + 1;
    return {
      hash: fnv1a(`${key}:${index}`).toString(16).padStart(8, '0').slice(0, 7),
      subject: text(locale, `demo.report.commit.${index}` as SharedMessageKey),
      branch: 'main',
      at: last.from + Math.round(((i + 1) / (count + 1)) * (last.to - last.from)),
      source: 'transcript',
    };
  });
}

function tasksOf(rng: Rng, plan: Shift[], locale: Locale): ReportTask[] {
  const count = rng() < 0.2 ? 0 : between(rng, 1, 5);
  const first = between(rng, 1, TASK_KEYS);
  const span = plan[plan.length - 1] as Shift;
  return Array.from({ length: count }, (_, i): ReportTask => ({
    title: text(locale, `demo.report.task.${((first + i * 2) % TASK_KEYS) + 1}` as SharedMessageKey),
    at: span.from + Math.round(((i + 1) / (count + 1)) * (span.to - span.from)),
  }));
}

function usageOf(
  agent: Agent,
  range: DayRange,
  rows: readonly UsageRow[],
  activeMs: number,
): { tokens: number; costUSD: number } {
  let tokens = 0;
  let costUSD = 0;
  for (const row of rows) {
    if (
      row.account !== agent.accountId ||
      row.session !== agent.sessionId ||
      row.hour < range.start - HOUR_MS ||
      row.hour >= range.end
    )
      continue;
    tokens += rowTokens(row);
    costUSD += row.costUSD;
  }
  if (tokens > 0) return { tokens, costUSD };
  const synthetic = Math.round((activeMs / MIN) * TOKENS_PER_ACTIVE_MINUTE);
  return { tokens: synthetic, costUSD: synthetic * USD_PER_TOKEN };
}

/** When a demo person worked on a day (the report and the time-lapse tell the same story), and the generator that went with it. */
export function demoShiftPlan(
  agentId: string,
  range: DayRange,
  now: number,
): { plan: Shift[]; rng: () => number } | undefined {
  const rng = mulberry32(fnv1a(`${agentId}|${range.date}`));
  const weekend = [0, 6].includes(new Date(range.start).getDay());
  if (rng() < (weekend ? 0.7 : 0.12) && now >= range.end) return undefined;
  const plan = shifts(range, now, rng);
  return plan.length === 0 ? undefined : { plan, rng };
}

function agentReport(agent: Agent, input: DemoReportInput): ReportAgent | undefined {
  const shiftPlan = demoShiftPlan(agent.id, input.range, input.now);
  if (shiftPlan === undefined) return undefined;
  const { plan, rng } = shiftPlan;
  const activity = activityOf(input.range, plan, rng);
  const activeMs = activity.reduce((sum, ms) => sum + ms, 0);
  const scale = Math.min(1, 0.4 + activeMs / (4 * HOUR_MS));
  const spec = DEMO_PROJECTS.find((candidate) => candidate.path === agent.projectId);
  const prompts = Math.max(2, Math.round(between(rng, 4, 14) * scale));
  const lastShift = plan[plan.length - 1] as Shift;
  const waiting = between(rng, 3, 12) * MIN;
  return {
    agentId: agent.id,
    accountId: agent.accountId,
    sessionId: agent.sessionId,
    name: agent.name,
    firstAt: (plan[0] as Shift).from,
    lastAt: lastShift.to,
    activeMs,
    statusMs: {
      working: activeMs,
      waiting,
      idle: Math.max(0, lastShift.to - (plan[0] as Shift).from - activeMs - waiting),
    },
    prompts,
    ...(input.includeRequests
      ? {
          requests: Array.from({ length: Math.min(prompts, 6) }, (_, i) =>
            translateShared(input.locale, spec?.prompts[i % (spec.prompts.length || 1)]?.msg ?? msg('demo.sub.1')),
          ),
        }
      : {}),
    toolCalls: toolCalls(rng, scale),
    files: filesOf(rng, agent.projectId, scale),
    commands: commandsOf(rng, agent.projectId),
    tests: testsOf(rng, agent.projectId, lastShift),
    commits: commitsOf(rng, `${agent.id}|${input.range.date}`, plan, input.locale),
    tasks: tasksOf(rng, plan, input.locale),
    subagents:
      rng() < 0.6
        ? { count: between(rng, 1, 3), types: ['Explore', 'general-purpose'].slice(0, between(rng, 1, 2)) }
        : { count: 0, types: [] },
    usage: usageOf(agent, input.range, input.usageRows, activeMs),
    activity,
  };
}

/** The report of a day for the demo office. Only main agents have a day of their own; subagents are folded in. */
export function demoDayReport(input: DemoReportInput): DayReport {
  const byProject = new Map<string, ReportAgent[]>();
  for (const agent of input.agents) {
    if (agent.kind !== 'main' || (input.account !== 'all' && agent.accountId !== input.account)) continue;
    const report = agentReport(agent, input);
    if (report !== undefined) byProject.set(agent.projectId, [...(byProject.get(agent.projectId) ?? []), report]);
  }
  const total = (agents: readonly ReportAgent[]): number => agents.reduce((sum, agent) => sum + agent.activeMs, 0);
  const projects: ReportProject[] = [...byProject]
    .map(([id, agents]) => ({
      id,
      name: id.split('/').filter(Boolean).pop() ?? id,
      agents: [...agents].sort((a, b) => b.activeMs - a.activeMs),
    }))
    .sort((a, b) => total(b.agents) - total(a.agents));
  return {
    date: input.range.date,
    generatedAt: input.now,
    account: input.account,
    includeRequests: input.includeRequests,
    projects,
    demo: true,
  };
}
