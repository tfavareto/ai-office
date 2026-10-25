import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { FeedItem, Notice } from '@ai-office/shared';
import { silentLogger } from '../log';
import { NameStore } from '../office/name-store';
import { Office } from '../office/office';
import { T0, jsonl } from '../test-helpers';
import { CODEX_OPEN_WINDOW_MS, CodexEngine } from './engine';
import {
  CWD,
  type FakeCodexHome,
  THREAD,
  assistantMessage,
  event,
  makeFakeCodex,
  record,
  sessionMeta,
  shellCall,
  functionOutput,
  taskComplete,
  taskStarted,
  tokenCount,
  turnContext,
  userMessage,
} from './fixtures';

const CHILD = '0199aaaa-bbbb-7ccc-8ddd-0000000000c1';
const REVIEW = '0199aaaa-bbbb-7ccc-8ddd-0000000000d1';

let fake: FakeCodexHome;
let clock: number;
let feed: FeedItem[];
let notices: Notice[];
let office: Office;
let engine: CodexEngine;
let enabled: boolean;

function build(extraDirs: string[] = []): void {
  feed = [];
  notices = [];
  enabled = true;
  office = new Office({
    now: () => clock,
    names: new NameStore(undefined, silentLogger),
    log: silentLogger,
    overlays: { permissionFor: () => undefined, attentionFor: () => undefined },
    events: {
      onChange: () => undefined,
      onFeed: (items) => void feed.push(...items),
      onNotice: (notice) => void notices.push(notice),
      onAgentEvent: () => undefined,
    },
  });
  engine = new CodexEngine({
    discover: { homeDir: fake.home, envDir: undefined, extraDirs },
    office,
    settings: {
      get sessions() {
        return enabled;
      },
    },
    log: silentLogger,
    now: () => clock,
  });
}

beforeEach(async () => {
  fake = await makeFakeCodex();
  clock = T0 + 60_000;
});
afterEach(async () => {
  engine.stop();
  await fake.cleanup();
});

const agents = () => office.state().agents;

const working = () =>
  jsonl(
    sessionMeta(-50_000),
    turnContext(-49_000),
    taskStarted(-48_000),
    userMessage('Corrigir o login', -47_000),
    shellCall('c1', ['bash', '-lc', 'npm test'], 59_000),
  );

describe('discovery and status', () => {
  test('an open rollout becomes a Codex agent in the room of its folder', async () => {
    await fake.write(THREAD, working());
    build();
    await engine.scan();
    expect(agents()).toHaveLength(1);
    expect(agents()[0]).toMatchObject({
      id: `codex:${THREAD}`,
      kind: 'main',
      source: 'codex',
      accountId: 'codex',
      projectId: CWD,
      status: 'working',
      gitBranch: 'feature-x',
      model: 'gpt-5.6-sol',
      title: 'Corrigir o login',
      activity: { kind: 'bash' },
    });
    expect(office.state().accounts).toMatchObject([{ id: 'codex', label: 'Codex', source: 'codex' }]);
    expect(office.state().projects).toMatchObject([{ id: CWD, name: 'codex-proj' }]);
    expect(engine.sessionCounts().get('codex')).toBe(1);
  });

  test('history is replayed silently, new lines reach the feed, and the turn ends idle', async () => {
    const path = await fake.write(
      THREAD,
      jsonl(sessionMeta(-600_000), taskStarted(-599_000), userMessage('antigo', -598_000), taskComplete(-597_000)),
    );
    build();
    await engine.scan();
    expect(feed).toHaveLength(0);
    expect(agents()[0]).toMatchObject({ status: 'idle' });
    await fake.append(path, jsonl(taskStarted(59_000), shellCall('c', ['ls'], 59_500)));
    clock += 1000;
    await engine.scan();
    expect(feed.map((item) => item.activity.kind)).toEqual(['bash']);
    expect(agents()[0]).toMatchObject({ status: 'working' });
    await fake.append(
      path,
      jsonl(functionOutput('c', 'a', 60_000, 0), assistantMessage('pronto', 61_000), taskComplete(62_000)),
    );
    clock += 2000;
    await engine.scan();
    expect(agents()[0]).toMatchObject({ status: 'idle' });
    expect(notices.some((notice) => notice.level === 'success')).toBe(true);
  });

  test('an approval request makes the agent wait', async () => {
    await fake.write(THREAD, jsonl(working(), event('exec_approval_request', 59_500, { call_id: 'c1' })));
    build();
    await engine.scan();
    expect(agents()[0]).toMatchObject({ status: 'waiting', waitingFor: 'Aprovar Bash' });
    expect(agents()[0]?.permission).toBeUndefined();
  });

  test('tokens and an estimated cost follow the totals', async () => {
    await fake.write(
      THREAD,
      jsonl(
        working(),
        tokenCount({ input_tokens: 2_000_000, cached_input_tokens: 1_000_000, output_tokens: 100_000 }, 59_500),
      ),
    );
    build();
    await engine.scan();
    expect(agents()[0]?.stats).toMatchObject({ tokensIn: 1_000_000, tokensOut: 100_000, costUSD: 4 + 0.4 + 2 });
  });

  test('Codex names the thread in session_index.jsonl', async () => {
    await fake.write(THREAD, working());
    await writeFile(
      join(fake.dir, 'session_index.jsonl'),
      `${JSON.stringify({ id: THREAD, thread_name: 'Login fix' })}\n`,
    );
    build();
    await engine.scan();
    expect(agents()[0]?.title).toBe('Login fix');
  });

  test('a session that arrives later is announced; the first scan is silent', async () => {
    build();
    await engine.scan();
    expect(notices).toHaveLength(0);
    await fake.write(THREAD, working());
    clock += 5000;
    await engine.scan();
    expect(notices.map((notice) => notice.msg?.key)).toContain('notice.arrived');
  });
});

describe('subagents and housekeeping threads', () => {
  test('a spawned thread appears next to its parent; a review thread does not', async () => {
    await fake.write(THREAD, working());
    await fake.write(
      CHILD,
      jsonl(
        sessionMeta(-20_000, {
          id: CHILD,
          source: {
            subagent: {
              thread_spawn: { parent_thread_id: THREAD, depth: 1, agent_nickname: 'Ada', agent_role: 'explorer' },
            },
          },
        }),
        taskStarted(-19_000),
        shellCall('s1', ['ls'], 59_000),
      ),
    );
    await fake.write(
      REVIEW,
      jsonl(
        sessionMeta(-20_000, {
          id: REVIEW,
          source: { subagent: { other: 'guardian_review' } },
          parent_thread_id: THREAD,
        }),
        taskStarted(-19_000),
      ),
    );
    build();
    await engine.scan();
    expect(agents().map((agent) => [agent.kind, agent.role, agent.title, agent.status])).toEqual([
      ['main', 'Principal', 'Corrigir o login', 'working'],
      ['sub', 'explorer', 'Ada', 'working'],
    ]);
    expect(agents()[1]).toMatchObject({ source: 'codex', parentId: `codex:${THREAD}` });
    expect(engine.pathOf('codex', THREAD, CHILD)).toMatch(/\.jsonl$/);
  });

  test('a spawned thread whose parent is not open is ignored', async () => {
    await fake.write(
      CHILD,
      jsonl(
        sessionMeta(0, { id: CHILD, source: { subagent: { thread_spawn: { parent_thread_id: 'ghost' } } } }),
        taskStarted(1),
      ),
    );
    build();
    await engine.scan();
    expect(agents()).toHaveLength(0);
  });
});

describe('open and closed sessions', () => {
  test('a rollout quiet for longer than the window has left', async () => {
    const path = await fake.write(THREAD, working());
    build();
    await engine.scan();
    expect(agents()).toHaveLength(1);
    const stale = new Date(clock - CODEX_OPEN_WINDOW_MS - 60_000);
    await utimes(path, stale, stale);
    clock += 6000;
    await engine.scan();
    expect(agents()[0]).toMatchObject({ status: 'offline' });
    expect(notices.map((notice) => notice.msg?.key)).toContain('notice.left');
    expect(engine.sessionCounts().get('codex') ?? 0).toBe(0);
  });

  test('a session that was not written for a long time is never opened', async () => {
    const path = await fake.write(THREAD, working());
    const stale = new Date(clock - CODEX_OPEN_WINDOW_MS - 60_000);
    await utimes(path, stale, stale);
    build();
    await engine.scan();
    expect(agents()).toHaveLength(0);
  });

  test('a truncated rollout is read again from the start', async () => {
    const path = await fake.write(THREAD, working());
    build();
    await engine.scan();
    await writeFile(
      path,
      jsonl(sessionMeta(-50_000), taskStarted(-48_000), userMessage('novo', -47_000), taskComplete(-46_000)),
    );
    clock += 1000;
    await engine.scan();
    expect(agents()[0]).toMatchObject({ status: 'idle', title: 'novo' });
  });
});

describe('the setting and the homes', () => {
  test('turning Codex off removes its accounts and sessions; on brings them back', async () => {
    await fake.write(THREAD, working());
    build();
    await engine.scan();
    expect(agents()).toHaveLength(1);
    enabled = false;
    await engine.reload();
    expect(engine.accountList()).toEqual([]);
    expect(office.state().accounts).toEqual([]);
    clock += 7000;
    await engine.scan();
    expect(agents().filter((agent) => agent.status !== 'offline')).toHaveLength(0);
    enabled = true;
    await engine.reload();
    expect(engine.accountList()).toHaveLength(1);
  });

  test('no Codex home means no account and no agents', async () => {
    build();
    await engine.scan();
    expect(engine.accountList()).toHaveLength(1);
    const lonely = new CodexEngine({
      discover: { homeDir: join(fake.home, 'nowhere'), envDir: undefined, extraDirs: [] },
      office,
      settings: { sessions: true },
      log: silentLogger,
      now: () => clock,
    });
    await lonely.scan();
    expect(lonely.accountList()).toEqual([]);
  });

  test('extra homes are separate accounts', async () => {
    const extra = join(fake.home, 'codex-work');
    await mkdir(join(extra, 'sessions', '2026', '10', '19'), { recursive: true });
    const other = '0199aaaa-bbbb-7ccc-8ddd-0000000000e1';
    await writeFile(
      join(extra, 'sessions', '2026', '10', '19', `rollout-2026-10-19T12-00-00-${other}.jsonl`),
      jsonl(sessionMeta(-5000, { id: other, cwd: '/work/other' }), taskStarted(-4000)),
    );
    await fake.write(THREAD, working());
    build([extra]);
    await engine.scan();
    expect(engine.accountList().map((account) => account.id)).toEqual(['codex', 'codex-codex-work']);
    expect(
      agents()
        .map((agent) => [agent.accountId, agent.projectId])
        .sort(),
    ).toEqual([
      ['codex', CWD],
      ['codex-codex-work', '/work/other'],
    ]);
  });

  test('damaged lines in a rollout are skipped', async () => {
    await fake.write(
      THREAD,
      `${working()}not json\n{"half":\n${record('event_msg', { type: 'unknown_kind' }, 59_800)}\n`,
    );
    build();
    await engine.scan();
    expect(agents()).toHaveLength(1);
  });
});
