import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Account, type Agent, type UsageRow, dayRange, localDateKey } from '@ai-office/shared';
import { silentLogger } from '../log';
import {
  type FakeClaudeDir,
  T0,
  assistantLine,
  jsonl,
  makeFakeClaude,
  text,
  toolResultLine,
  toolUse,
  userLine,
} from '../test-helpers';
import { ReportService, type ReportDeps } from './service';

const MIN = 60_000;
const range = dayRange(localDateKey(T0));
if (range === undefined) throw new Error('no range');

let fake: FakeClaudeDir;
let account: Account;
beforeEach(async () => {
  fake = await makeFakeClaude();
  account = { id: 'claude', label: 'Pessoal', initial: 'P', color: '#fff', dir: fake.dir, isDefault: true };
});
afterEach(() => fake.cleanup());

const row = (session: string, over: Partial<UsageRow> = {}): UsageRow => ({
  hour: Math.floor(T0 / 3_600_000) * 3_600_000,
  account: 'claude',
  project: '/work/proj',
  model: 'claude-sonnet-5-5',
  session,
  agent: '',
  input: 1000,
  output: 500,
  cacheWrite: 200,
  cacheRead: 9000,
  costUSD: 0.25,
  ...over,
});

function service(over: Partial<ReportDeps> = {}, rows: UsageRow[] = []): ReportService {
  return new ReportService({
    now: () => T0 + 60 * MIN,
    log: silentLogger,
    usage: {
      rows: () => rows.values(),
      progress: () => ({ state: 'ready', percent: 100, filesDone: 0, filesTotal: 0 }),
    },
    dayStats: async (date) => ({
      date,
      agents: [
        {
          agentId: 'claude:s1',
          name: 'Ana',
          projectId: '/work/proj',
          ms: { working: 600_000, waiting: 60_000, idle: 120_000, done: 0, offline: 0 },
        },
      ],
    }),
    agents: () => [{ id: 'claude:s1', name: 'Ana' } as unknown as Agent],
    storedName: (key) => (key === 'claude:s2' ? 'Bruno' : undefined),
    ...over,
  });
}

const request = (includeRequests = false) => ({ range, accounts: [account], label: 'all', includeRequests });

const call = (id: string, name: string, input: Record<string, unknown>, at: number): string =>
  assistantLine([toolUse(id, name, input)], at);

async function seedSession(): Promise<void> {
  await fake.writeTranscript(
    's1',
    jsonl(
      userLine('Faça o carrinho\ncom detalhes privados', 0),
      call('e1', 'Edit', { file_path: '/work/proj/src/cart.ts', old_string: 'a', new_string: 'b\nc' }, 1 * MIN),
      toolResultLine('e1', 'ok', 1 * MIN + 500, {
        toolUseResult: { structuredPatch: [{ lines: ['+b', '+c', '-a'] }] },
      }),
      call('t1', 'Bash', { command: 'npx vitest run' }, 2 * MIN),
      toolResultLine('t1', 'Tests  8 passed (8)', 2 * MIN + 500),
      call('c1', 'Bash', { command: 'git commit -m "feat: cart"' }, 3 * MIN),
      toolResultLine('c1', '[main abc1234] feat: cart', 3 * MIN + 500),
      call('a1', 'Agent', { description: 'Explorar', subagent_type: 'Explore' }, 4 * MIN),
      assistantLine([text('pronto')], 5 * MIN),
    ),
  );
  await fake.writeSubagent(
    's1',
    'sub1',
    jsonl(
      userLine('Explore', 4 * MIN + 1000, { agentId: 'sub1' }),
      call('r1', 'Read', { file_path: '/work/proj/a.ts' }, 4 * MIN + 2000),
    ),
    { agentType: 'Explore' },
  );
}

describe('ReportService', () => {
  test('builds the report of a session: files, tests, commits, subagents, usage, name and status times', async () => {
    await seedSession();
    const report = await service({}, [
      row('s1'),
      row('s1', { agent: 'sub1', input: 100, output: 50, cacheWrite: 0, costUSD: 0.05 }),
    ]).report(request());
    const project = report.projects[0];
    const agent = project?.agents[0];
    expect(report).toMatchObject({ date: range.date, account: 'all', includeRequests: false });
    expect(project).toMatchObject({ id: '/work/proj', name: 'proj' });
    expect(agent).toMatchObject({
      agentId: 'claude:s1',
      name: 'Ana',
      prompts: 1,
      files: [{ path: 'src/cart.ts', edits: 1, added: 2, removed: 1 }],
      tests: [{ runner: 'vitest', outcome: 'passed', passed: 8 }],
      commits: [{ hash: 'abc1234', subject: 'feat: cart', branch: 'main', source: 'transcript' }],
      subagents: { count: 1, types: ['Explore'] },
      usage: { tokens: 1700 + 150, costUSD: 0.3 },
      statusMs: { working: 600_000, waiting: 60_000, idle: 120_000 },
    });
    expect(agent?.toolCalls).toMatchObject({ edit: 1, bash: 2, subagent: 1, read: 1 });
    expect(agent?.activeMs).toBeGreaterThan(0);
  });

  test('never includes the text of the prompts unless asked, and then only the first line', async () => {
    await seedSession();
    const plain = await service().report(request());
    expect(JSON.stringify(plain)).not.toMatch(/carrinho|privados/);
    const asked = await service().report(request(true));
    expect(asked.projects[0]?.agents[0]?.requests).toEqual(['Faça o carrinho']);
    expect(JSON.stringify(asked)).not.toContain('privados');
  });

  test('names sessions that are not in the office from the stored names, then from the deterministic pick', async () => {
    await fake.writeTranscript('s2', jsonl(userLine('oi', 0)));
    await fake.writeTranscript('s3', jsonl(userLine('oi', 0)));
    const report = await service().report(request());
    const names = Object.fromEntries(
      report.projects.flatMap((project) => project.agents).map((agent) => [agent.sessionId, agent.name]),
    );
    expect(names.s2).toBe('Bruno');
    expect(names.s3).toMatch(/\S/);
  });

  test('picks up what was appended since the last report', async () => {
    await seedSession();
    const reports = service();
    expect((await reports.report(request())).projects[0]?.agents[0]?.prompts).toBe(1);
    await fake.appendTranscript('s1', jsonl(userLine('de novo', 10 * MIN)));
    expect((await reports.report(request())).projects[0]?.agents[0]?.prompts).toBe(2);
  });

  test('a transient read gives the same report without filling the cache the page relies on', async () => {
    await seedSession();
    const reports = service();
    const cacheSize = (): number => (reports as unknown as { cache: Map<string, unknown> }).cache.size;

    const transient = await reports.report({ ...request(), transient: true });
    expect(cacheSize()).toBe(0);
    const normal = await reports.report(request());

    expect(cacheSize()).toBeGreaterThan(0);
    expect(transient.projects).toEqual(normal.projects);
  });

  test('ignores transcripts that were not touched on the day', async () => {
    const path = await fake.writeTranscript('old', jsonl(userLine('antigo', -3 * 24 * 60 * MIN)));
    const { utimes } = await import('node:fs/promises');
    await utimes(path, new Date(T0 - 3 * 24 * 3_600_000), new Date(T0 - 3 * 24 * 3_600_000));
    expect((await service().report(request())).projects).toEqual([]);
  });

  test('flags a scan that hit the file limit', async () => {
    await fake.writeTranscript('s1', jsonl(userLine('a', 0)));
    await fake.writeTranscript('s2', jsonl(userLine('b', 0)));
    const report = await service({ limits: { maxFiles: 1 } }).report(request());
    expect(report.truncated).toBe(true);
  });

  test('reports that the usage index is still building', async () => {
    await seedSession();
    const reports = service({
      usage: {
        rows: () => [].values(),
        progress: () => ({ state: 'indexing', percent: 10, filesDone: 1, filesTotal: 9 }),
      },
    });
    expect((await reports.report(request())).usageIndexing).toBe(true);
  });

  test('concurrent requests for the same report share one scan', async () => {
    await seedSession();
    const reports = service();
    expect(reports.report(request())).toBe(reports.report(request()));
  });

  test('adds the commits of the Git integration to the project, when there is one', async () => {
    await seedSession();
    const commit = { hash: 'fff0000', subject: 'from git', at: T0, source: 'git' as const };
    const report = await service({ gitCommits: async (path) => (path === '/work/proj' ? [commit] : []) }).report(
      request(),
    );
    expect(report.projects[0]?.gitCommits).toEqual([commit]);
  });

  test('a failing Git integration leaves the report as it was', async () => {
    await seedSession();
    const report = await service({ gitCommits: async () => Promise.reject(new Error('no git')) }).report(request());
    expect(report.projects[0]?.gitCommits).toBeUndefined();
  });
});
