import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { UsageDetail } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import {
  type FakeClaudeDir,
  T0,
  assistantLine,
  freePort,
  jsonl,
  makeFakeClaude,
  makeTempDir,
  removeDir,
  text,
  userLine,
} from '../test-helpers';

let fake: FakeClaudeDir;
let state: string;
let web: string;
let app: App;
let port: number;

async function boot(extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  port = await freePort();
  const config = loadConfig(
    { HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...extraEnv },
    [],
    web,
  );
  app = createApp(config, silentLogger, { now: () => T0 + 60_000, pidAlive: () => true, version: '9.9.9' });
  await app.start();
  await app.context.usage.refresh({ walk: true });
}

beforeEach(async () => {
  fake = await makeFakeClaude();
  state = join(await makeTempDir('ai-office-state-'), 'state');
  web = join(await makeTempDir('ai-office-web-'), 'dist');
});
afterEach(async () => {
  await app.stop();
  await removeDir(fake.home);
  await removeDir(join(state, '..'));
  await removeDir(join(web, '..'));
});

const base = (): string => `http://127.0.0.1:${port}`;
const authed = (): Record<string, string> => ({ authorization: `Bearer ${app.context.auth.value}` });
const query = (search: string, headers: Record<string, string> = authed()): Promise<Response> =>
  fetch(`${base()}/api/usage/detail${search}`, { headers });

async function seed(): Promise<void> {
  await fake.writeRegistry(100, {
    sessionId: 's1',
    name: 'Sessão de teste',
    status: 'busy',
    statusUpdatedAt: T0 + 59_000,
  });
  await fake.writeTranscript(
    's1',
    jsonl(
      userLine('Faça algo', 100),
      assistantLine([text('a')], 1000, {
        id: 'm1',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 3000,
        },
      }),
      assistantLine([text('b')], 2000, {
        id: 'm2',
        model: 'claude-opus-5-5',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    ),
  );
  await fake.writeSubagent(
    's1',
    'sub1',
    jsonl(
      assistantLine([text('c')], 3000, {
        id: 'sm1',
        model: 'claude-haiku-4-5',
        usage: { input_tokens: 7, output_tokens: 3 },
        extra: { agentId: 'sub1' },
      }),
    ),
  );
}

describe('GET /api/usage/detail', () => {
  test('needs the access token', async () => {
    await boot();
    const response = await query('?account=all&period=today', {});
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  test('answers with totals, breakdowns, windows and progress for the period', async () => {
    // Arrange
    await seed();
    await boot();
    // Act
    const response = await query('?account=all&period=week');
    const body = (await response.json()) as UsageDetail;
    // Assert
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      account: 'all',
      period: 'week',
      granularity: 'day',
      progress: { state: 'ready', percent: 100 },
    });
    expect(body.totals).toMatchObject({ input: 117, output: 58, cacheWrite: 200, cacheRead: 3000, tokens: 375 });
    expect(body.totals.costUSD).toBeGreaterThan(0);
    expect(body.byModel.map((row) => row.family).sort()).toEqual(['haiku', 'opus', 'sonnet']);
    expect(body.byProject).toMatchObject([{ project: '/work/proj', name: 'proj' }]);
    expect(body.series).toHaveLength(7);
    expect(body.windows).toMatchObject([{ account: 'claude', active: true, tokens: 375 }]);
    expect(body.range.start).toBeLessThanOrEqual(T0);
  });

  test('names the sessions the office knows and links them to their person', async () => {
    await seed();
    await boot();
    const body = (await (await query('?account=claude&period=today')).json()) as UsageDetail;
    const main = body.bySession.find((row) => row.agent === undefined);
    expect(main).toMatchObject({ session: 's1', title: 'Sessão de teste', officeId: 'claude:s1', projectName: 'proj' });
    expect(body.bySession.find((row) => row.agent === 'sub1')).toMatchObject({ session: 's1', agent: 'sub1' });
    expect(body.sessionCount).toBe(2);
  });

  test('defaults to every account and today', async () => {
    await boot();
    const body = (await (await query('')).json()) as UsageDetail;
    expect(body).toMatchObject({ account: 'all', period: 'today' });
  });

  test.each([
    ['?period=year', 400, 'invalid-period'],
    ['?period=', 400, 'invalid-period'],
    ['?account=../etc&period=today', 400, 'invalid-account'],
    ['?account=a%00b', 400, 'invalid-account'],
    [`?account=${'x'.repeat(300)}`, 400, 'invalid-account'],
    ['?account=nobody&period=today', 404, 'account-not-found'],
  ])('rejects %s', async (search, status, error) => {
    await boot();
    const response = await query(search);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  test('is local only: a server reachable from other addresses refuses it', async () => {
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });
    const response = await query('?account=all&period=today');
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'local-only' });
  });

  test('refuses cross-site requests', async () => {
    await boot();
    const response = await query('?account=all&period=today', { ...authed(), 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
  });

  test('in demo mode the demo accounts have a synthesized history', async () => {
    await boot();
    app.context.setDemo(true);
    app.context.office.refresh(T0 + 60_000);
    const body = (await (await query('?account=demo-trabalho&period=month')).json()) as UsageDetail;
    expect(body.demo).toBe(true);
    expect(body.totals.tokens).toBeGreaterThan(0);
    expect(body.previous.tokens).toBeGreaterThan(0);
    expect(body.bySession.length).toBeGreaterThan(0);
    expect(body.series.length).toBeGreaterThanOrEqual(28);
  });
});
