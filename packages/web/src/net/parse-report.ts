// Defensive parsing of GET /api/report/day: anything unreadable is dropped or zeroed, nothing is trusted.
import {
  REPORT_BUCKETS,
  REPORT_TOOL_KINDS,
  type DayReport,
  type ReportAgent,
  type ReportCommand,
  type ReportCommit,
  type ReportFileChange,
  type ReportProject,
  type ReportTask,
  type ReportTestRun,
  type ReportToolKind,
} from '@ai-office/shared';
import { t } from '../i18n';
import { isRecord } from './parse';

const TEXT_MAX = 400;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, TEXT_MAX) : fallback;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function list<T>(value: unknown, read: (item: Record<string, unknown>) => T | undefined): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = isRecord(item) ? read(item) : undefined;
    return parsed === undefined ? [] : [parsed];
  });
}

const file = (item: Record<string, unknown>): ReportFileChange | undefined =>
  typeof item.path === 'string'
    ? { path: str(item.path), edits: count(item.edits), added: count(item.added), removed: count(item.removed) }
    : undefined;

const command = (item: Record<string, unknown>): ReportCommand | undefined =>
  typeof item.command === 'string' ? { command: str(item.command), runs: Math.max(1, count(item.runs)) } : undefined;

const test = (item: Record<string, unknown>): ReportTestRun | undefined => {
  if (item.outcome !== 'passed' && item.outcome !== 'failed' && item.outcome !== 'unknown') return undefined;
  const passed = count(item.passed);
  const failed = count(item.failed);
  return {
    runner: str(item.runner, 'test'),
    at: count(item.at),
    outcome: item.outcome,
    ...(passed > 0 ? { passed } : {}),
    ...(failed > 0 ? { failed } : {}),
  };
};

const commit = (item: Record<string, unknown>): ReportCommit | undefined =>
  typeof item.hash === 'string' && typeof item.subject === 'string'
    ? {
        hash: str(item.hash),
        subject: str(item.subject),
        at: count(item.at),
        source: item.source === 'git' ? 'git' : 'transcript',
        ...(typeof item.branch === 'string' ? { branch: str(item.branch) } : {}),
      }
    : undefined;

const task = (item: Record<string, unknown>): ReportTask | undefined =>
  typeof item.title === 'string' ? { title: str(item.title), at: count(item.at) } : undefined;

function toolCalls(value: unknown): Partial<Record<ReportToolKind, number>> {
  const source = isRecord(value) ? value : {};
  const result: Partial<Record<ReportToolKind, number>> = {};
  for (const kind of REPORT_TOOL_KINDS) if (count(source[kind]) > 0) result[kind] = count(source[kind]);
  return result;
}

function activity(value: unknown): number[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: REPORT_BUCKETS }, (_, i) => count(source[i]));
}

function agent(item: Record<string, unknown>): ReportAgent | undefined {
  if (typeof item.agentId !== 'string' || typeof item.name !== 'string') return undefined;
  const status = isRecord(item.statusMs) ? item.statusMs : undefined;
  const usage = isRecord(item.usage) ? item.usage : {};
  const subagents = isRecord(item.subagents) ? item.subagents : {};
  return {
    agentId: str(item.agentId),
    accountId: str(item.accountId),
    sessionId: str(item.sessionId),
    name: str(item.name),
    firstAt: count(item.firstAt),
    lastAt: count(item.lastAt),
    activeMs: count(item.activeMs),
    ...(status !== undefined
      ? { statusMs: { working: count(status.working), waiting: count(status.waiting), idle: count(status.idle) } }
      : {}),
    prompts: count(item.prompts),
    ...(Array.isArray(item.requests)
      ? {
          requests: item.requests
            .filter((request): request is string => typeof request === 'string')
            .map((request) => str(request)),
        }
      : {}),
    toolCalls: toolCalls(item.toolCalls),
    files: list(item.files, file),
    commands: list(item.commands, command),
    tests: list(item.tests, test),
    commits: list(item.commits, commit),
    tasks: list(item.tasks, task),
    subagents: {
      count: count(subagents.count),
      types: Array.isArray(subagents.types)
        ? subagents.types.filter((type): type is string => typeof type === 'string').map((type) => str(type))
        : [],
    },
    usage: { tokens: count(usage.tokens), costUSD: count(usage.costUSD) },
    activity: activity(item.activity),
  };
}

function project(item: Record<string, unknown>): ReportProject | undefined {
  if (typeof item.id !== 'string') return undefined;
  const gitCommits = list(item.gitCommits, commit);
  return {
    id: str(item.id),
    name: str(item.name),
    agents: list(item.agents, agent),
    ...(gitCommits.length > 0 ? { gitCommits } : {}),
  };
}

export function parseDayReport(data: unknown): DayReport {
  if (!isRecord(data) || typeof data.date !== 'string') throw new Error(t('error.invalidResponse'));
  return {
    date: str(data.date),
    generatedAt: count(data.generatedAt),
    account: str(data.account, 'all'),
    includeRequests: data.includeRequests === true,
    projects: list(data.projects, project),
    ...(data.truncated === true ? { truncated: true } : {}),
    ...(data.usageIndexing === true ? { usageIndexing: true } : {}),
    ...(data.demo === true ? { demo: true } : {}),
  };
}
