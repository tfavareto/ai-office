// The day report, the time-lapse and the usage index read Codex rollouts through the same code as Claude transcripts.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Account, type Agent, type UsageRow, dayRange, localDateKey } from '@ai-office/shared';
import { silentLogger } from '../log';
import { ReportService } from '../report/service';
import { T0, jsonl, makeTempDir, removeDir } from '../test-helpers';
import { UsageIndexer } from '../usage/indexer';
import {
  CWD,
  type FakeCodexHome,
  PATCH,
  THREAD,
  applyPatch,
  assistantMessage,
  functionOutput,
  makeFakeCodex,
  sessionMeta,
  shellCall,
  taskComplete,
  taskStarted,
  tokenCount,
  turnContext,
  userMessage,
} from './fixtures';
import { codexAccounts } from './home';

const MIN = 60_000;
const HOUR = 3_600_000;
const range = dayRange(localDateKey(T0));
if (range === undefined) throw new Error('no range');
const CHILD = '0199aaaa-bbbb-7ccc-8ddd-0000000000c1';
const REVIEW = '0199aaaa-bbbb-7ccc-8ddd-0000000000d1';

let fake: FakeCodexHome;
let account: Account;
beforeEach(async () => {
  fake = await makeFakeCodex();
  account = codexAccounts([fake.dir])[0] as Account;
});
afterEach(() => fake.cleanup());

async function seed(): Promise<void> {
  await fake.write(
    THREAD,
    jsonl(
      sessionMeta(0),
      turnContext(100),
      taskStarted(200),
      userMessage('Faça o carrinho\ncom detalhes privados', 300),
      applyPatch('p1', PATCH, 1 * MIN),
      functionOutput('p1', 'Success', 1 * MIN + 500),
      shellCall('t1', ['bash', '-lc', 'npx vitest run'], 2 * MIN),
      functionOutput('t1', 'Tests  8 passed (8)', 2 * MIN + 500, 0),
      shellCall('c1', ['bash', '-lc', 'git commit -m "feat: cart"'], 3 * MIN),
      functionOutput('c1', '[main abc1234] feat: cart', 3 * MIN + 500, 0),
      tokenCount({ input_tokens: 1_000_000, cached_input_tokens: 400_000, output_tokens: 10_000 }, 4 * MIN),
      assistantMessage('pronto', 5 * MIN),
      taskComplete(5 * MIN + 100),
    ),
  );
  await fake.write(
    CHILD,
    jsonl(
      sessionMeta(4 * MIN, {
        id: CHILD,
        source: {
          subagent: { thread_spawn: { parent_thread_id: THREAD, agent_nickname: 'Ada', agent_role: 'explorer' } },
        },
      }),
      taskStarted(4 * MIN + 1000),
      shellCall('r1', ['cat', 'a.ts'], 4 * MIN + 2000),
    ),
  );
  await fake.write(
    REVIEW,
    jsonl(
      sessionMeta(4 * MIN, {
        id: REVIEW,
        source: { subagent: { other: 'guardian_review' } },
        parent_thread_id: THREAD,
      }),
      shellCall('g1', ['shred', 'secret-file'], 4 * MIN + 2000),
    ),
  );
}

function service(rows: UsageRow[] = []): ReportService {
  return new ReportService({
    now: () => T0 + 60 * MIN,
    log: silentLogger,
    usage: {
      rows: () => rows.values(),
      progress: () => ({ state: 'ready', percent: 100, filesDone: 0, filesTotal: 0 }),
    },
    dayStats: async (date) => ({ date, agents: [] }),
    agents: () => [{ id: `codex:${THREAD}`, name: 'Ana' } as unknown as Agent],
    storedName: () => undefined,
  });
}

const request = () => ({ range, accounts: [account], label: 'all', includeRequests: false });

describe('day report of a Codex session', () => {
  test('lists files, tests, commits and the subagent; leaves housekeeping threads out', async () => {
    await seed();
    const report = await service().report(request());
    const project = report.projects[0];
    const agent = project?.agents[0];
    expect(project).toMatchObject({ id: CWD, name: 'codex-proj' });
    expect(report.projects).toHaveLength(1);
    expect(agent).toMatchObject({
      agentId: `codex:${THREAD}`,
      name: 'Ana',
      prompts: 1,
      tests: [{ runner: 'vitest', outcome: 'passed', passed: 8 }],
      commits: [{ hash: 'abc1234', subject: 'feat: cart', branch: 'main', source: 'transcript' }],
    });
    expect(agent?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/new.ts', added: 2, removed: 0 }),
        expect.objectContaining({ path: 'src/old.ts', added: 2, removed: 1 }),
      ]),
    );
    expect(agent?.toolCalls).toMatchObject({ edit: 2, bash: 3 });
    expect(JSON.stringify(report)).not.toMatch(/carrinho|privados|shred/);
  });

  test('reading again after the rollout grew continues where it stopped', async () => {
    const path = await fake.write(
      THREAD,
      jsonl(
        sessionMeta(0),
        taskStarted(200),
        userMessage('x', 300),
        shellCall('t1', ['bash', '-lc', 'npx vitest run'], 2 * MIN),
        functionOutput('t1', 'Tests  3 passed (3)', 2 * MIN + 500, 0),
        shellCall('t2', ['bash', '-lc', 'npx vitest run'], 3 * MIN),
      ),
    );
    const reports = service();
    await reports.report(request());
    await fake.append(path, jsonl(functionOutput('t2', 'Tests  1 failed | 2 passed (3)', 3 * MIN + 500, 1)));
    const report = await reports.report(request());
    expect(report.projects[0]?.agents[0]?.tests).toHaveLength(2);
  });

  test('the time-lapse has the session and the subagent', async () => {
    await seed();
    const lapse = await service().timelapse({ range, accounts: [account], label: 'all' });
    expect(lapse.agents).toHaveLength(2);
  });
});

describe('usage index of Codex rollouts', () => {
  let state: string;
  let clock: number;
  let indexer: UsageIndexer;
  beforeEach(async () => {
    state = await makeTempDir('ai-office-index-');
    clock = T0 + 60 * MIN;
  });
  afterEach(async () => {
    await indexer?.stop();
    await removeDir(state);
  });

  async function boot(): Promise<UsageIndexer> {
    indexer = new UsageIndexer({ stateDir: state, accounts: () => [account], log: silentLogger, now: () => clock });
    await indexer.start();
    await indexer.refresh({ walk: true });
    return indexer;
  }
  const rows = (target: UsageIndexer): UsageRow[] =>
    [...target.rows()].sort((a, b) => a.hour - b.hour || a.agent.localeCompare(b.agent));

  test('the usage of a moment is the growth of the running total, split by hour', async () => {
    await fake.write(
      THREAD,
      jsonl(
        sessionMeta(0),
        turnContext(100),
        tokenCount({ input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100 }, 1000),
        tokenCount({ input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100 }, 2000),
        tokenCount({ input_tokens: 3000, cached_input_tokens: 1400, output_tokens: 300 }, HOUR + 1000),
      ),
    );
    const target = await boot();
    const hour = Math.floor(T0 / HOUR) * HOUR;
    expect(rows(target)).toEqual([
      {
        hour,
        account: 'codex',
        project: CWD,
        model: 'gpt-5.6-sol',
        session: THREAD,
        agent: '',
        input: 600,
        output: 100,
        cacheWrite: 0,
        cacheRead: 400,
        costUSD: (600 * 4 + 100 * 20 + 400 * 0.4) / 1e6,
      },
      expect.objectContaining({ hour: hour + HOUR, input: 1000, output: 200, cacheRead: 1000 }),
    ]);
  });

  test('a restart counts only what was written since', async () => {
    const path = await fake.write(
      THREAD,
      jsonl(sessionMeta(0), turnContext(100), tokenCount({ input_tokens: 1000, output_tokens: 100 }, 1000)),
    );
    await boot();
    await indexer.stop();
    await fake.append(path, jsonl(tokenCount({ input_tokens: 1500, output_tokens: 150 }, 2000)));
    const target = await boot();
    const total = rows(target).reduce((sum, row) => sum + row.input + row.output, 0);
    expect(total).toBe(1500 + 150);
  });

  test('subagent and housekeeping threads belong to their parent session', async () => {
    await fake.write(
      THREAD,
      jsonl(sessionMeta(0), turnContext(100), tokenCount({ input_tokens: 100, output_tokens: 10 }, 1000)),
    );
    await fake.write(
      CHILD,
      jsonl(
        sessionMeta(0, { id: CHILD, source: { subagent: { thread_spawn: { parent_thread_id: THREAD } } } }),
        turnContext(100, { model: 'gpt-5.6-terra' }),
        tokenCount({ input_tokens: 200, output_tokens: 20 }, 1000),
      ),
    );
    await fake.write(
      REVIEW,
      jsonl(
        sessionMeta(0, { id: REVIEW, source: { subagent: { other: 'guardian_review' } }, parent_thread_id: THREAD }),
        turnContext(100, { model: 'codex-auto-review' }),
        tokenCount({ input_tokens: 50, output_tokens: 5 }, 1000),
      ),
    );
    const target = await boot();
    expect(rows(target).map((row) => [row.session, row.agent, row.model, row.costUSD > 0])).toEqual([
      [THREAD, '', 'gpt-5.6-sol', true],
      [THREAD, CHILD, 'gpt-5.6-terra', true],
      [THREAD, REVIEW, 'codex-auto-review', false],
    ]);
  });

  test('lines older than the history window are not counted, but still set the baseline', async () => {
    const old = -90 * 24 * HOUR;
    await fake.write(
      THREAD,
      jsonl(
        sessionMeta(old),
        turnContext(old + 100),
        tokenCount({ input_tokens: 1000, output_tokens: 100 }, old + 1000),
        tokenCount({ input_tokens: 1300, output_tokens: 130 }, 1000),
      ),
    );
    const target = await boot();
    expect(rows(target).reduce((sum, row) => sum + row.input, 0)).toBe(300);
  });
});
