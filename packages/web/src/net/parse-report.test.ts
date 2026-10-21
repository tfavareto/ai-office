import { describe, expect, it } from 'vitest';
import { REPORT_BUCKETS } from '@ai-office/shared';
import { parseDayReport } from './parse-report';

describe('parseDayReport', () => {
  it('reads a well-formed report', () => {
    const report = parseDayReport({
      date: '2026-10-21',
      generatedAt: 5,
      account: 'claude',
      includeRequests: true,
      truncated: true,
      projects: [
        {
          id: '/work/loja',
          name: 'loja',
          agents: [
            {
              agentId: 'claude:s1',
              accountId: 'claude',
              sessionId: 's1',
              name: 'Ana',
              firstAt: 1,
              lastAt: 2,
              activeMs: 3,
              statusMs: { working: 1, waiting: 2, idle: 3 },
              prompts: 4,
              requests: ['oi'],
              toolCalls: { read: 3, bogus: 9 },
              files: [{ path: 'a.ts', edits: 1, added: 2, removed: 3 }],
              commands: [{ command: 'npm test', runs: 2 }],
              tests: [{ runner: 'vitest', at: 1, outcome: 'passed', passed: 4 }],
              commits: [{ hash: 'abc', subject: 's', at: 1, source: 'git', branch: 'main' }],
              tasks: [{ title: 't', at: 1 }],
              subagents: { count: 1, types: ['Explore'] },
              usage: { tokens: 10, costUSD: 0.5 },
              activity: [1, 2, 3],
            },
          ],
        },
      ],
    });
    expect(report).toMatchObject({ date: '2026-10-21', account: 'claude', includeRequests: true, truncated: true });
    const agent = report.projects[0]?.agents[0];
    expect(agent).toMatchObject({ name: 'Ana', toolCalls: { read: 3 }, requests: ['oi'], statusMs: { waiting: 2 }, commits: [{ source: 'git', branch: 'main' }] });
    expect(agent?.activity).toHaveLength(REPORT_BUCKETS);
    expect(agent?.activity.slice(0, 4)).toEqual([1, 2, 3, 0]);
  });

  it('drops what cannot be read and zeroes what is not a number', () => {
    const report = parseDayReport({
      date: '2026-10-21',
      projects: [
        'nope',
        { id: 5 },
        { id: '/a', name: 'a', agents: [{ agentId: 'x' }, { agentId: 'y', name: 'Y', activeMs: -4, prompts: 'many', files: [{ path: 3 }, { path: 'ok.ts' }], tests: [{ outcome: 'weird' }], usage: 'free' }] },
      ],
    });
    expect(report.projects).toHaveLength(1);
    const agents = report.projects[0]?.agents ?? [];
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ activeMs: 0, prompts: 0, files: [{ path: 'ok.ts', edits: 0 }], tests: [], usage: { tokens: 0, costUSD: 0 } });
    expect(agents[0]?.requests).toBeUndefined();
  });

  it('refuses a body that is not a report', () => {
    expect(() => parseDayReport(null)).toThrow();
    expect(() => parseDayReport({ projects: [] })).toThrow();
  });
});
