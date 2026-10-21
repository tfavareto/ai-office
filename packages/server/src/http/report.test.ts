// End to end: GET /api/report/day over real HTTP — access control, validation, date bounds, privacy defaults, demo.
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type DayReport, addDays, localDateKey, startOfDay } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import { T0, assistantLine, freePort, jsonl, makeFakeClaude, makeTempDir, removeDir, text, toolResultLine, toolUse, userLine, type FakeClaudeDir } from '../test-helpers';

const NOW = T0 + 60_000;
let fake: FakeClaudeDir;
let state: string;
let web: string;
let app: App;
let port: number;

async function boot(extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  port = await freePort();
  const config = loadConfig({ HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...extraEnv }, [], web);
  app = createApp(config, silentLogger, { now: () => NOW, pidAlive: () => true, version: '9.9.9' });
  await app.start();
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

const today = localDateKey(NOW);
const daysAgo = (days: number): string => localDateKey(addDays(startOfDay(NOW), -days));
const auth = (): Record<string, string> => ({ authorization: `Bearer ${app.context.auth.value}` });
const get = (query: string, headers: Record<string, string> = auth()): Promise<Response> => fetch(`http://127.0.0.1:${port}/api/report/day${query}`, { headers });

async function seedSession(): Promise<void> {
  await fake.writeRegistry(100, { sessionId: 's1', name: 'Sessão', status: 'busy', statusUpdatedAt: T0 + 59_000 });
  await fake.writeTranscript(
    's1',
    jsonl(
      userLine('Ajuste o carrinho\nsegredo da empresa', 10_000),
      assistantLine([toolUse('c1', 'Bash', { command: 'git commit -m "feat: x"' })], 20_000),
      toolResultLine('c1', '[main abc1234] feat: x', 21_000),
      assistantLine([text('feito')], 30_000),
    ),
  );
}

describe('GET /api/report/day', () => {
  test('needs the token and a request that comes from this computer', async () => {
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });
    expect((await get('', {})).status).toBe(401);
    expect((await get('', { ...auth(), 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const remote = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/report/day', headers: { host: `192.168.1.20:${port}`, ...auth() } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(remote).toBe(403);
  });

  test('accepts today and the six days before it and refuses anything else', async () => {
    await boot();
    for (const date of [today, daysAgo(1), daysAgo(6)]) expect((await get(`?date=${date}`)).status, date).toBe(200);
    for (const date of [daysAgo(7), localDateKey(NOW + 2 * 86_400_000)]) {
      const response = await get(`?date=${date}`);
      expect([response.status, (await response.json()) as unknown], date).toEqual([400, { error: 'date-out-of-range' }]);
    }
  });

  test.each([
    ['?date=21-10-2026', 'invalid-date'],
    ['?date=2026-02-31', 'date-out-of-range'],
    ['?date=../../etc', 'invalid-date'],
    ['?account=../x', 'invalid-account'],
    ['?requests=yes', 'invalid-requests'],
    ['?locale=fr', 'invalid-locale'],
  ])('rejects %s', async (query, error) => {
    await boot();
    const response = await get(query);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
  });

  test('an account that does not exist is a 404; a known one or "all" works', async () => {
    await seedSession();
    await boot();
    expect((await get('?account=nope')).status).toBe(404);
    expect((await get('?account=claude')).status).toBe(200);
    expect((await get('?account=all')).status).toBe(200);
  });

  test('reports the day without any prompt text by default, and the first line only when asked', async () => {
    await seedSession();
    await boot();
    const plain = await get(`?date=${today}`);
    const body = (await plain.json()) as DayReport;
    expect(JSON.stringify(body)).not.toMatch(/carrinho|segredo/);
    expect(body.projects[0]?.agents[0]).toMatchObject({ agentId: 'claude:s1', prompts: 1, commits: [{ hash: 'abc1234', subject: 'feat: x' }] });
    expect(body.includeRequests).toBe(false);

    const asked = (await (await get(`?date=${today}&requests=1`)).json()) as DayReport;
    expect(asked.projects[0]?.agents[0]?.requests).toEqual(['Ajuste o carrinho']);
    expect(JSON.stringify(asked)).not.toContain('segredo');
  });

  test('an empty day has no projects', async () => {
    await boot();
    expect(await (await get(`?date=${daysAgo(2)}`)).json()).toMatchObject({ date: daysAgo(2), projects: [] });
  });

  test('demo mode adds believable work for every day, in the requested language', async () => {
    await boot();
    app.context.setDemo(true);
    const pt = (await (await get(`?date=${today}&locale=pt-BR`)).json()) as DayReport;
    const en = (await (await get(`?date=${today}&locale=en`)).json()) as DayReport;
    expect(pt.demo).toBe(true);
    expect(pt.projects.length).toBeGreaterThan(0);
    const subjects = (report: DayReport): string[] => report.projects.flatMap((project) => project.agents).flatMap((agent) => agent.commits.map((commit) => commit.subject));
    expect(subjects(pt)).not.toEqual(subjects(en));
    expect(((await (await get(`?date=${daysAgo(3)}`)).json()) as DayReport).demo).toBe(true);
  });
});
