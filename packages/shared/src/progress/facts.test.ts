import { describe, expect, test } from 'vitest';
import { reportAgent, reportProject } from '../report/fixtures';
import { REPORT_BUCKETS, type DayReport } from '../report/types';
import { factsFromReport } from './facts';

const HALF_HOUR = 1_800_000;

function report(projects: DayReport['projects']): DayReport {
  return { date: '2026-10-20', generatedAt: 0, account: 'all', includeRequests: false, projects };
}

function activeIn(...buckets: number[]): number[] {
  const activity = new Array<number>(REPORT_BUCKETS).fill(0);
  for (const bucket of buckets) activity[bucket] = HALF_HOUR;
  return activity;
}

describe('factsFromReport', () => {
  test('has nothing for a day nobody worked', () => {
    expect(factsFromReport(report([]))).toBeUndefined();
  });

  test('sums the day over agents and projects', () => {
    const ana = reportAgent({
      name: 'Ana',
      activeMs: 7_200_000,
      tasks: [
        { title: 'a', at: 1 },
        { title: 'b', at: 2 },
      ],
      tests: [
        { runner: 'vitest', at: 1, outcome: 'passed' },
        { runner: 'vitest', at: 2, outcome: 'failed' },
      ],
      commits: [{ hash: 'abc1234', subject: 's', at: 1, source: 'transcript' }],
      usage: { tokens: 1000, costUSD: 1 },
      subagents: { count: 3, types: [] },
    });
    const bruno = reportAgent({ name: 'Bruno', activeMs: 3_600_000, tasks: [{ title: 'c', at: 3 }] });
    const facts = factsFromReport(
      report([
        reportProject([ana], { gitCommits: [{ hash: 'abc1234ffff', subject: 's', at: 1, source: 'git' }] }),
        reportProject([bruno], { id: '/work/api', name: 'api' }),
      ]),
    );

    expect(facts).toMatchObject({
      sessions: 2,
      activeMs: 10_800_000,
      tasks: 3,
      commits: 1,
      testsPassed: 1,
      tokens: 1000,
      subagents: 3,
    });
    expect(facts?.workers).toEqual([
      { name: 'Ana', project: 'loja', tasks: 2 },
      { name: 'Bruno', project: 'api', tasks: 1 },
    ]);
  });

  test('the peak is the most agents working in the same half hour', () => {
    const facts = factsFromReport(
      report([
        reportProject([
          reportAgent({ activity: activeIn(20, 21) }),
          reportAgent({ agentId: 'b', activity: activeIn(21, 22) }),
          reportAgent({ agentId: 'c', activity: activeIn(21) }),
        ]),
      ]),
    );

    expect(facts?.peakAgents).toBe(3);
  });

  test('work after midnight makes a night owl and before seven an early bird', () => {
    const night = factsFromReport(report([reportProject([reportAgent({ activity: activeIn(3, 4) })])]));
    const early = factsFromReport(report([reportProject([reportAgent({ activity: activeIn(11, 12) })])]));
    const day = factsFromReport(report([reportProject([reportAgent({ activity: activeIn(20, 21) })])]));

    expect(night).toMatchObject({ night: true, early: false });
    expect(early).toMatchObject({ night: false, early: true });
    expect(day).toMatchObject({ night: false, early: false });
  });

  test('a blip of activity at night is not a night owl', () => {
    const activity = new Array<number>(REPORT_BUCKETS).fill(0);
    activity[2] = 10_000;

    expect(factsFromReport(report([reportProject([reportAgent({ activity })])]))?.night).toBe(false);
  });
});
