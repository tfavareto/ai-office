// Defensive parsing of GET /api/usage/detail: every number is checked, unknown shapes are rejected.
import {
  type UsageDetail,
  type UsageModelRow,
  type UsageProgress,
  type UsageProjectRow,
  type UsageRange,
  type UsageSeriesPoint,
  type UsageSessionRow,
  type UsageTotals,
  type UsageWindowInfo,
  isUsagePeriod,
  modelFamily,
} from '@ai-office/shared';
import { t } from '../i18n';
import { isMsg } from '../ui/display';
import { isRecord } from './parse';

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function totals(value: unknown): UsageTotals {
  const raw = isRecord(value) ? value : {};
  return {
    input: num(raw.input),
    output: num(raw.output),
    cacheWrite: num(raw.cacheWrite),
    cacheRead: num(raw.cacheRead),
    tokens: num(raw.tokens),
    costUSD: num(raw.costUSD),
  };
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function range(value: unknown): UsageRange {
  const raw = isRecord(value) ? value : {};
  return {
    start: num(raw.start),
    end: num(raw.end),
    previousStart: num(raw.previousStart),
    previousEnd: num(raw.previousEnd),
  };
}

function progress(value: unknown): UsageProgress {
  const raw = isRecord(value) ? value : {};
  return {
    state: raw.state === 'indexing' ? 'indexing' : 'ready',
    percent: Math.min(100, Math.max(0, num(raw.percent))),
    filesDone: num(raw.filesDone),
    filesTotal: num(raw.filesTotal),
  };
}

function session(raw: Record<string, unknown>): UsageSessionRow {
  return {
    account: str(raw.account),
    session: str(raw.session),
    ...(typeof raw.agent === 'string' && raw.agent !== '' ? { agent: raw.agent } : {}),
    project: str(raw.project),
    projectName: str(raw.projectName),
    lastAt: num(raw.lastAt),
    ...(typeof raw.officeId === 'string' ? { officeId: raw.officeId } : {}),
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(isMsg(raw.titleMsg) ? { titleMsg: raw.titleMsg } : {}),
    ...(typeof raw.role === 'string' ? { role: raw.role } : {}),
    ...(isMsg(raw.roleMsg) ? { roleMsg: raw.roleMsg } : {}),
    ...totals(raw),
  };
}

function window(raw: Record<string, unknown>): UsageWindowInfo {
  return {
    account: str(raw.account),
    start: num(raw.start),
    resetsAt: num(raw.resetsAt),
    tokens: num(raw.tokens),
    costUSD: num(raw.costUSD),
    active: raw.active === true,
  };
}

export function parseUsageDetail(data: unknown): UsageDetail {
  if (!isRecord(data) || !isUsagePeriod(data.period) || typeof data.account !== 'string')
    throw new Error(t('error.invalidResponse'));
  return {
    account: data.account,
    period: data.period,
    generatedAt: num(data.generatedAt),
    range: range(data.range),
    granularity: data.granularity === 'hour' ? 'hour' : 'day',
    totals: totals(data.totals),
    previous: totals(data.previous),
    series: list(data.series).map((raw): UsageSeriesPoint => ({
      start: num(raw.start),
      end: num(raw.end),
      ...totals(raw),
    })),
    byModel: list(data.byModel).map((raw): UsageModelRow => ({
      model: str(raw.model),
      family: modelFamily(str(raw.model)),
      ...totals(raw),
    })),
    byProject: list(data.byProject).map((raw): UsageProjectRow => ({
      project: str(raw.project),
      name: str(raw.name),
      ...totals(raw),
    })),
    bySession: list(data.bySession).map(session),
    sessionCount: num(data.sessionCount),
    windows: list(data.windows).map(window),
    progress: progress(data.progress),
    ...(data.demo === true ? { demo: true } : {}),
  };
}
