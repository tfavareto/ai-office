// "Meu dia": aggregates the server's per-agent status times into bars and totals.
import type { AgentStatus, DayStats } from '@ai-office/shared';
import { t } from '../../i18n';

export const DAY_STATUSES = ['working', 'waiting', 'idle'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export function dayStatusLabel(status: DayStatus): string {
  return t(`day.status.${status}`);
}

export interface DaySegment {
  status: DayStatus;
  ms: number;
  /** Width in percent of the longest row. */
  widthPct: number;
}

export interface DayRow {
  agentId: string;
  name: string;
  projectId: string;
  totalMs: number;
  segments: DaySegment[];
}

export interface DayView {
  rows: DayRow[];
  totals: Record<DayStatus, number>;
  totalMs: number;
}

function safeMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function aggregateDay(stats: DayStats): DayView {
  const totals: Record<DayStatus, number> = { working: 0, waiting: 0, idle: 0 };
  const raw = stats.agents.map((agent) => {
    const ms = agent.ms as Partial<Record<AgentStatus, number>>;
    const values: Record<DayStatus, number> = {
      working: safeMs(ms.working),
      waiting: safeMs(ms.waiting),
      idle: safeMs(ms.idle),
    };
    const totalMs = values.working + values.waiting + values.idle;
    return { agent, values, totalMs };
  });
  const longest = Math.max(0, ...raw.map((row) => row.totalMs));
  const rows: DayRow[] = raw
    .filter((row) => row.totalMs > 0)
    .sort(
      (a, b) =>
        b.values.working - a.values.working || b.totalMs - a.totalMs || a.agent.name.localeCompare(b.agent.name),
    )
    .map(({ agent, values, totalMs }) => {
      for (const status of DAY_STATUSES) totals[status] += values[status];
      return {
        agentId: agent.agentId,
        name: agent.name,
        projectId: agent.projectId,
        totalMs,
        segments: DAY_STATUSES.map((status) => ({
          status,
          ms: values[status],
          widthPct: longest > 0 ? (values[status] / longest) * 100 : 0,
        })),
      };
    });
  return { rows, totals, totalMs: totals.working + totals.waiting + totals.idle };
}
