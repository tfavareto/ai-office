import { describe, expect, test } from 'vitest';
import { reportAgent, reportProject } from './fixtures';
import { agentTotals, hasActivity, mergeCommits, projectTotals, reportTotals } from './totals';

const commit = (hash: string, at: number, source: 'transcript' | 'git' = 'transcript') => ({
  hash,
  subject: `s ${hash}`,
  at,
  source,
});

describe('mergeCommits', () => {
  test('keeps one commit per hash, treating a short hash as the full one', () => {
    const merged = mergeCommits([commit('abc1234', 5)], [commit('abc1234def', 6, 'git'), commit('fff0000', 1, 'git')]);
    expect(merged.map((item) => item.hash)).toEqual(['fff0000', 'abc1234']);
    expect(merged[1]?.source).toBe('transcript');
  });
});

describe('projectTotals', () => {
  test('counts a file edited by two agents once and sums the lines', () => {
    const a = reportAgent({
      files: [{ path: 'src/a.ts', edits: 1, added: 3, removed: 1 }],
      tasks: [{ title: 't', at: 1 }],
    });
    const b = reportAgent({
      agentId: 'claude:s2',
      files: [
        { path: 'src/a.ts', edits: 2, added: 2, removed: 0 },
        { path: 'b.ts', edits: 1, added: 1, removed: 0 },
      ],
    });
    const totals = projectTotals(reportProject([a, b]));
    expect(totals).toMatchObject({
      agents: 2,
      files: 2,
      linesAdded: 6,
      linesRemoved: 1,
      tasks: 1,
      toolCalls: 10,
      prompts: 4,
    });
  });

  test('counts tests by outcome and merges Git commits with transcript commits', () => {
    const agent = reportAgent({
      tests: [
        { runner: 'vitest', at: 1, outcome: 'passed' },
        { runner: 'vitest', at: 2, outcome: 'failed' },
        { runner: 'pytest', at: 3, outcome: 'unknown' },
      ],
      commits: [commit('aaa1111', 1)],
      usage: { tokens: 1000, costUSD: 0.5 },
    });
    const totals = projectTotals(
      reportProject([agent], { gitCommits: [commit('aaa1111', 1, 'git'), commit('bbb2222', 2, 'git')] }),
    );
    expect(totals).toMatchObject({
      testsPassed: 1,
      testsFailed: 1,
      testsUnknown: 1,
      commits: 2,
      tokens: 1000,
      costUSD: 0.5,
    });
  });
});

describe('reportTotals', () => {
  test('adds the projects and reports activity only when some agent exists', () => {
    const project = reportProject([reportAgent({ activeMs: 10 })]);
    expect(reportTotals({ projects: [project, { ...project, id: '/b' }] }).activeMs).toBe(20);
    expect(agentTotals(reportAgent()).agents).toBe(1);
    expect(hasActivity({ projects: [project] })).toBe(true);
    expect(hasActivity({ projects: [] })).toBe(false);
  });
});
