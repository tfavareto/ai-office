// Builders for report tests (shared, server and web).
import type { ReportAgent, ReportProject } from './types';
import { REPORT_BUCKETS } from './types';

export function reportAgent(over: Partial<ReportAgent> = {}): ReportAgent {
  return {
    agentId: 'claude:s1',
    accountId: 'claude',
    sessionId: 's1',
    name: 'Ana',
    firstAt: 1000,
    lastAt: 2000,
    activeMs: 60_000,
    prompts: 2,
    toolCalls: { read: 3, edit: 2 },
    files: [],
    commands: [],
    tests: [],
    commits: [],
    tasks: [],
    subagents: { count: 0, types: [] },
    usage: { tokens: 0, costUSD: 0 },
    activity: new Array<number>(REPORT_BUCKETS).fill(0),
    ...over,
  };
}

export function reportProject(agents: ReportAgent[], over: Partial<ReportProject> = {}): ReportProject {
  return { id: '/work/loja', name: 'loja', agents, ...over };
}
