// Pure arithmetic over a day report: headline numbers per agent, project and day, and the merge of commit lists.
import type { DayReport, ReportAgent, ReportCommit, ReportProject, ReportTotals } from './types';

export const EMPTY_TOTALS: ReportTotals = {
  agents: 0,
  activeMs: 0,
  prompts: 0,
  toolCalls: 0,
  files: 0,
  linesAdded: 0,
  linesRemoved: 0,
  commits: 0,
  testsPassed: 0,
  testsFailed: 0,
  testsUnknown: 0,
  tasks: 0,
  subagents: 0,
  tokens: 0,
  costUSD: 0,
};

/** Commits by hash (a short hash and the full one are the same commit); the earlier list wins, result in time order. */
export function mergeCommits(...lists: readonly (readonly ReportCommit[] | undefined)[]): ReportCommit[] {
  const kept: ReportCommit[] = [];
  for (const list of lists) {
    for (const commit of list ?? []) {
      const known = kept.some((other) => other.hash.startsWith(commit.hash) || commit.hash.startsWith(other.hash));
      if (!known) kept.push(commit);
    }
  }
  return kept.sort((a, b) => a.at - b.at);
}

/** Distinct files an agent list touched (by path within one project). */
function filePaths(agents: readonly ReportAgent[]): Map<string, { added: number; removed: number }> {
  const files = new Map<string, { added: number; removed: number }>();
  for (const agent of agents) {
    for (const file of agent.files) {
      const found = files.get(file.path) ?? { added: 0, removed: 0 };
      files.set(file.path, { added: found.added + file.added, removed: found.removed + file.removed });
    }
  }
  return files;
}

export function agentTotals(agent: ReportAgent): ReportTotals {
  return projectTotals({ id: '', name: '', agents: [agent] });
}

export function projectCommits(project: ReportProject): ReportCommit[] {
  return mergeCommits(...project.agents.map((agent) => agent.commits), project.gitCommits);
}

export function projectTotals(project: ReportProject): ReportTotals {
  const files = filePaths(project.agents);
  let result: ReportTotals = {
    ...EMPTY_TOTALS,
    agents: project.agents.length,
    files: files.size,
    commits: projectCommits(project).length,
  };
  for (const stats of files.values())
    result = {
      ...result,
      linesAdded: result.linesAdded + stats.added,
      linesRemoved: result.linesRemoved + stats.removed,
    };
  for (const agent of project.agents) {
    result = {
      ...result,
      activeMs: result.activeMs + agent.activeMs,
      prompts: result.prompts + agent.prompts,
      toolCalls:
        result.toolCalls + Object.values(agent.toolCalls).reduce<number>((sum, count) => sum + (count ?? 0), 0),
      testsPassed: result.testsPassed + agent.tests.filter((run) => run.outcome === 'passed').length,
      testsFailed: result.testsFailed + agent.tests.filter((run) => run.outcome === 'failed').length,
      testsUnknown: result.testsUnknown + agent.tests.filter((run) => run.outcome === 'unknown').length,
      tasks: result.tasks + agent.tasks.length,
      subagents: result.subagents + agent.subagents.count,
      tokens: result.tokens + agent.usage.tokens,
      costUSD: result.costUSD + agent.usage.costUSD,
    };
  }
  return result;
}

export function reportTotals(report: Pick<DayReport, 'projects'>): ReportTotals {
  return report.projects.map(projectTotals).reduce<ReportTotals>(
    (sum, item) => ({
      agents: sum.agents + item.agents,
      activeMs: sum.activeMs + item.activeMs,
      prompts: sum.prompts + item.prompts,
      toolCalls: sum.toolCalls + item.toolCalls,
      files: sum.files + item.files,
      linesAdded: sum.linesAdded + item.linesAdded,
      linesRemoved: sum.linesRemoved + item.linesRemoved,
      commits: sum.commits + item.commits,
      testsPassed: sum.testsPassed + item.testsPassed,
      testsFailed: sum.testsFailed + item.testsFailed,
      testsUnknown: sum.testsUnknown + item.testsUnknown,
      tasks: sum.tasks + item.tasks,
      subagents: sum.subagents + item.subagents,
      tokens: sum.tokens + item.tokens,
      costUSD: sum.costUSD + item.costUSD,
    }),
    EMPTY_TOTALS,
  );
}

/** Whether anything at all happened (an empty day shows an empty state). */
export function hasActivity(report: Pick<DayReport, 'projects'>): boolean {
  return report.projects.some((project) => project.agents.length > 0);
}
