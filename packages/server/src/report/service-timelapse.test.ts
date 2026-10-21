// The time-lapse of a day built from synthetic transcripts through the report service: same reader, same cache.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Account, type Agent, type Timelapse, dayRange, localDateKey } from '@ai-office/shared';
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
const SEC = 1000;
const range = dayRange(localDateKey(T0));
if (range === undefined) throw new Error('no range');

let fake: FakeClaudeDir;
let account: Account;
beforeEach(async () => {
  fake = await makeFakeClaude();
  account = { id: 'claude', label: 'Pessoal', initial: 'P', color: '#fff', dir: fake.dir, isDefault: true };
});
afterEach(() => fake.cleanup());

function service(over: Partial<ReportDeps> = {}): ReportService {
  return new ReportService({
    now: () => T0 + 120 * MIN,
    log: silentLogger,
    usage: { rows: () => [].values(), progress: () => ({ state: 'ready', percent: 100, filesDone: 0, filesTotal: 0 }) },
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
    agents: () => [{ id: 'claude:s1', name: 'Ana', look: 'f' } as unknown as Agent],
    storedName: (key) => (key === 'claude:s2' ? 'Bruno' : undefined),
    ...over,
  });
}

const request = { range, accounts: [] as Account[], label: 'all' };
const timelapse = (reports: ReportService): Promise<Timelapse> =>
  reports.timelapse({ ...request, accounts: [account] });

const call = (id: string, name: string, input: Record<string, unknown>, at: number): string =>
  assistantLine([toolUse(id, name, input)], at);

async function seedSession(): Promise<void> {
  await fake.writeTranscript(
    's1',
    jsonl(
      userLine('Faça o carrinho\ncom detalhes privados', 0),
      call('e1', 'Edit', { file_path: '/work/proj/src/cart.ts', old_string: 'a', new_string: 'b' }, 1 * MIN),
      toolResultLine('e1', 'ok', 1 * MIN + 500),
      call('t1', 'Bash', { command: 'npx vitest run' }, 2 * MIN),
      toolResultLine('t1', 'Tests  2 failed | 8 passed (10)', 2 * MIN + 500, {}, true),
      call('c1', 'Bash', { command: 'git commit -m "feat: cart"' }, 3 * MIN),
      toolResultLine('c1', '[main abc1234] feat: cart', 3 * MIN + 500),
      call('a1', 'Agent', { description: 'Explorar o código', subagent_type: 'Explore' }, 4 * MIN),
      toolResultLine('a1', 'resultado do subagente', 6 * MIN),
      assistantLine([text('pronto')], 7 * MIN, { stopReason: 'end_turn' }),
    ),
  );
  await fake.writeSubagent(
    's1',
    'sub1',
    jsonl(
      userLine('Explore o código secreto', 4 * MIN + SEC, { agentId: 'sub1' }),
      call('r1', 'Read', { file_path: '/work/proj/a.ts' }, 4 * MIN + 5 * SEC),
    ),
    { agentType: 'Explore', description: 'Explorar o código', toolUseId: 'a1' },
  );
}

describe('ReportService.timelapse', () => {
  test('tells the day of a session: the person, the subagent, what they did, the failed tests and the commit', async () => {
    await seedSession();
    const tl = await timelapse(service());

    expect(tl).toMatchObject({ date: range.date, account: 'all', start: range.start, end: range.end });
    expect(tl.projects).toMatchObject([{ id: '/work/proj', name: 'proj', order: 0 }]);
    expect(tl.agents).toMatchObject([
      {
        id: 'claude:s1',
        kind: 'main',
        name: 'Ana',
        look: 'f',
        projectId: '/work/proj',
        recordedMs: { working: 600_000, waiting: 60_000, idle: 120_000 },
      },
      { id: 'claude:s1:sub1', kind: 'sub', parentId: 'claude:s1', role: 'Explore', title: 'Explorar o código' },
    ]);
    const types = tl.events.map((event) => event.type);
    for (const type of ['arrive', 'status', 'activity', 'test', 'commit', 'leave']) expect(types, type).toContain(type);
    expect(tl.events.find((event) => event.type === 'test')).toMatchObject({
      runner: 'vitest',
      outcome: 'failed',
      agent: 0,
    });
    expect(tl.events.find((event) => event.type === 'commit')).toMatchObject({
      hash: 'abc1234',
      subject: 'feat: cart',
      agent: 0,
      project: 0,
    });
    expect(tl.events.filter((event) => event.type === 'arrive').map((event) => event.at)).toEqual([T0, T0 + 4 * MIN]);
    expect(tl.from).toBe(T0);
  });

  test('carries no message bodies: not the prompt, not the reply, not the tool results, not the subagent prompt', async () => {
    await seedSession();
    const json = JSON.stringify(await timelapse(service()));

    expect(json).not.toMatch(/privados|carrinho|pronto|resultado do subagente|secreto/);
  });

  test('shares the report cache: a report then a time-lapse of the same day read each file only to bring it up to date', async () => {
    await seedSession();
    const reports = service();
    const report = await reports.report({ range, accounts: [account], label: 'all', includeRequests: false });
    const first = await timelapse(reports);
    await fake.appendTranscript(
      's1',
      jsonl(userLine('de novo', 30 * MIN), call('r2', 'Read', { file_path: '/work/proj/b.ts' }, 31 * MIN)),
    );
    const second = await timelapse(reports);
    const again = await reports.report({ range, accounts: [account], label: 'all', includeRequests: false });

    expect(report.projects[0]?.agents[0]?.prompts).toBe(1);
    expect(first.events.length).toBeLessThan(second.events.length);
    expect(again.projects[0]?.agents[0]?.prompts).toBe(2);
    expect(second.events.some((event) => event.type === 'activity' && event.at === T0 + 31 * MIN)).toBe(true);
  });

  test('names sessions that are not in the office from the stored names, then from the pick, without repeating', async () => {
    await fake.writeTranscript('s2', jsonl(userLine('oi', 0)));
    await fake.writeTranscript('s3', jsonl(userLine('oi', MIN)));
    const tl = await timelapse(service());
    const names = Object.fromEntries(tl.agents.map((agent) => [agent.id, agent.name]));

    expect(names['claude:s2']).toBe('Bruno');
    expect(new Set(Object.values(names)).size).toBe(2);
  });

  test('an empty day has nothing to replay', async () => {
    const tl = await timelapse(service());

    expect(tl).toMatchObject({ projects: [], agents: [], events: [] });
    expect(tl.from).toBeUndefined();
  });

  test('adds the commits Git saw that the transcript did not', async () => {
    await seedSession();
    const commit = { hash: 'fff0000', subject: 'chore: by hand', at: T0 + 8 * MIN, source: 'git' as const };
    const tl = await timelapse(service({ gitCommits: async () => [commit] }));

    expect(
      tl.events.filter((event) => event.type === 'commit').map((event) => (event.type === 'commit' ? event.hash : '')),
    ).toEqual(['abc1234', 'fff0000']);
  });

  test('flags a scan that hit a limit and survives a failing Git integration', async () => {
    await fake.writeTranscript('s1', jsonl(userLine('a', 0)));
    await fake.writeTranscript('s2', jsonl(userLine('b', 0)));
    const tl = await timelapse(
      service({ limits: { maxFiles: 1 }, gitCommits: async () => Promise.reject(new Error('no git')) }),
    );

    expect(tl.truncated).toBe(true);
    expect(tl.agents).toHaveLength(1);
  });

  test('concurrent requests for the same day share one scan', async () => {
    await seedSession();
    const reports = service();

    expect(reports.timelapse({ ...request, accounts: [account] })).toBe(
      reports.timelapse({ ...request, accounts: [account] }),
    );
  });
});
