import { describe, expect, test } from 'vitest';
import { REPORT_BUCKETS } from '@ai-office/shared';
import type { FileDay } from './accumulator';
import { type BuildInput, buildDayReport } from './build';

const empty = (): number[] => new Array<number>(REPORT_BUCKETS).fill(0);

function fileDay(over: Partial<FileDay> = {}): FileDay {
  return {
    role: 'main',
    cwd: '/work/loja',
    title: undefined,
    firstAt: 1000,
    lastAt: 5000,
    prompts: 1,
    requests: ['Corrija o carrinho'],
    toolCalls: { edit: 2 },
    files: [],
    commands: [],
    tests: [],
    commits: [],
    tasks: [],
    subagentCount: 0,
    subagentTypes: [],
    activity: empty(),
    ...over,
  };
}

function input(sessions: BuildInput['sessions'], over: Partial<BuildInput> = {}): BuildInput {
  return {
    date: '2026-10-19',
    now: 9000,
    account: 'all',
    includeRequests: false,
    sessions,
    nameOf: (_account, session) => `Pessoa ${session}`,
    usageOf: () => ({ tokens: 10, costUSD: 0.1 }),
    statusOf: () => undefined,
    truncated: false,
    usageIndexing: false,
    ...over,
  };
}

describe('buildDayReport', () => {
  test('folds a subagent into its session: files by relative path, tool calls, tokens, parallel time', () => {
    const mainActivity = empty();
    mainActivity[2] = 10 * 60_000;
    const subActivity = empty();
    subActivity[2] = 4 * 60_000;
    subActivity[3] = 6 * 60_000;
    const main = fileDay({ files: [{ path: '/work/loja/src/a.ts', edits: 1, added: 2, removed: 0 }], activity: mainActivity, subagentCount: 1, subagentTypes: ['Explore'] });
    const sub = fileDay({ role: 'sub', files: [{ path: '/work/loja/src/a.ts', edits: 2, added: 1, removed: 1 }, { path: '/etc/hosts', edits: 1, added: 1, removed: 0 }], toolCalls: { read: 5 }, activity: subActivity, prompts: 0, requests: [] });
    const report = buildDayReport(input([{ accountId: 'claude', sessionId: 's1', files: [main, sub] }]));
    const agent = report.projects[0]?.agents[0];
    expect(agent?.files).toEqual([
      { path: 'src/a.ts', edits: 3, added: 3, removed: 1 },
      { path: '/etc/hosts', edits: 1, added: 1, removed: 0 },
    ]);
    expect(agent?.toolCalls).toEqual({ edit: 2, read: 5 });
    expect(agent?.subagents).toEqual({ count: 1, types: ['Explore'] });
    expect(agent?.activeMs).toBe(10 * 60_000 + 6 * 60_000);
    expect(agent).toMatchObject({ agentId: 'claude:s1', name: 'Pessoa s1', prompts: 1, usage: { tokens: 10, costUSD: 0.1 } });
  });

  test('groups sessions by project, busiest first, and drops sessions without events', () => {
    const busy = empty();
    busy[0] = 20 * 60_000;
    const light = empty();
    light[0] = 5 * 60_000;
    const report = buildDayReport(
      input([
        { accountId: 'claude', sessionId: 's1', files: [fileDay({ cwd: '/work/blog', activity: light })] },
        { accountId: 'claude', sessionId: 's2', files: [fileDay({ cwd: '/work/loja', activity: busy })] },
        { accountId: 'claude', sessionId: 's3', files: [fileDay({ cwd: '/work/loja', activity: light })] },
        { accountId: 'claude', sessionId: 's4', files: [fileDay({ firstAt: undefined, lastAt: undefined })] },
      ]),
    );
    expect(report.projects.map((project) => project.name)).toEqual(['loja', 'blog']);
    expect(report.projects[0]?.agents.map((agent) => agent.sessionId)).toEqual(['s2', 's3']);
  });

  test('keeps the first line of the prompts only when asked for', () => {
    const session = { accountId: 'claude', sessionId: 's1', files: [fileDay()] };
    expect(buildDayReport(input([session])).projects[0]?.agents[0]?.requests).toBeUndefined();
    expect(buildDayReport(input([session], { includeRequests: true })).projects[0]?.agents[0]?.requests).toEqual(['Corrija o carrinho']);
  });

  test('merges commits and tasks across files and attaches recorded status times', () => {
    const commit = { hash: 'abc1234', subject: 'feat', at: 5, source: 'transcript' as const };
    const main = fileDay({ commits: [commit], tasks: [{ title: 'Rota', at: 9 }] });
    const sub = fileDay({ role: 'sub', commits: [commit], tasks: [{ title: 'Rota', at: 4 }] });
    const status = { working: 10, waiting: 2, idle: 3 };
    const report = buildDayReport(input([{ accountId: 'claude', sessionId: 's1', files: [main, sub] }], { statusOf: (id) => (id === 'claude:s1' ? status : undefined) }));
    const agent = report.projects[0]?.agents[0];
    expect(agent?.commits).toHaveLength(1);
    expect(agent?.tasks).toEqual([{ title: 'Rota', at: 4 }]);
    expect(agent?.statusMs).toEqual(status);
  });

  test('carries the truncation and indexing flags', () => {
    const report = buildDayReport(input([], { truncated: true, usageIndexing: true }));
    expect(report).toMatchObject({ truncated: true, usageIndexing: true, projects: [] });
  });
});
