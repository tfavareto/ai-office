// End to end: /api/progress over real HTTP: access control, privacy of the project name, events, demo.
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Progress } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import { PROGRESS_FILE } from '../progress/store';
import {
  T0,
  assistantLine,
  freePort,
  jsonl,
  makeFakeClaude,
  makeTempDir,
  removeDir,
  text,
  toolResultLine,
  toolUse,
  userLine,
  type FakeClaudeDir,
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

const auth = (): Record<string, string> => ({ authorization: `Bearer ${app.context.auth.value}` });
const get = (query = '', headers: Record<string, string> = auth()): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/api/progress${query}`, { headers });
const post = (body: unknown, headers: Record<string, string> = auth()): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/api/progress/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('GET /api/progress', () => {
  test('needs the token and a request that comes from this computer', async () => {
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });

    expect((await get('', {})).status).toBe(401);
    expect((await get('', { ...auth(), 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const remote = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port, path: '/api/progress', headers: { host: `192.168.1.20:${port}`, ...auth() } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(remote).toBe(403);
  });

  test('a new office is level one with every achievement locked', async () => {
    await boot();

    const progress = (await (await get()).json()) as Progress;

    expect(progress.level.level).toBe(1);
    expect(progress.achievements.length).toBeGreaterThanOrEqual(20);
    expect(progress.achievements.every((entry) => entry.unlockedAt === undefined)).toBe(true);
  });

  test('is in the snapshot as a level and recent unlocks', async () => {
    await boot();

    expect(app.context.snapshots.build().progress).toMatchObject({ level: 1, recent: [] });
  });

  test('demo mode shows a believable office without touching the real progress', async () => {
    await boot();
    app.context.setDemo(true);

    const progress = (await (await get('?project=1')).json()) as Progress;

    expect(progress.demo).toBe(true);
    expect(progress.level.level).toBeGreaterThanOrEqual(6);
    expect(app.context.snapshots.build().progress?.demo).toBe(true);
    expect(app.context.progress.state.unlocks).toEqual({});
  });

  test('the employee project is only sent when asked for', async () => {
    await boot();
    app.context.setDemo(true);

    const plain = (await (await get()).json()) as Progress;
    const asked = (await (await get('?project=1')).json()) as Progress;

    expect(plain.employee?.name).toBeTruthy();
    expect(plain.employee).not.toHaveProperty('project');
    expect(asked.employee?.project).toBeTruthy();
  });
});

describe('progress from the transcripts', () => {
  test('counts the sessions and commits of today and unlocks their badges', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', name: 'Sessão', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript(
      's1',
      jsonl(
        userLine('Ajuste o carrinho', 10_000),
        assistantLine([toolUse('c1', 'Bash', { command: 'git commit -m "feat: x"' })], 20_000),
        toolResultLine('c1', '[main abc1234] feat: x', 21_000),
        assistantLine([text('feito')], 30_000),
      ),
    );
    await boot();

    await app.context.progress.refresh();
    const progress = (await (await get()).json()) as Progress;

    expect(progress.stats).toMatchObject({ sessions: 1, commits: 1, daysActive: 1 });
    const unlocked = progress.achievements.filter((entry) => entry.unlockedAt !== undefined).map((entry) => entry.id);
    expect(unlocked).toEqual(expect.arrayContaining(['firstSession', 'firstCommit']));
    expect(JSON.stringify(progress)).not.toContain('carrinho');
  });
});

describe('POST /api/progress/event', () => {
  test('records the first time of an event and unlocks its badge', async () => {
    await boot();

    expect((await post({ event: 'timelapse' })).status).toBe(200);

    const progress = (await (await get()).json()) as Progress;
    expect(progress.achievements.find((entry) => entry.id === 'timelapse')?.unlockedAt).toBeGreaterThan(0);
  });

  test.each([{ event: 'hack' }, { event: 3 }, {}, { events: 'share' }])('refuses %j', async (body) => {
    await boot();

    expect((await post(body)).status).toBe(400);
  });

  test('needs the token and the same origin', async () => {
    await boot();

    expect((await post({ event: 'share' }, {})).status).toBe(401);
    expect((await post({ event: 'share' }, { ...auth(), 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });

  test('the demo office counts for nothing', async () => {
    await boot();
    app.context.setDemo(true);

    expect((await post({ event: 'share' })).status).toBe(200);

    expect(app.context.progress.state.events).toEqual({});
  });

  test('is kept in the progress file when the office stops', async () => {
    await boot();
    await post({ event: 'share' });
    await app.stop();

    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse(await readFile(join(state, PROGRESS_FILE), 'utf8')) as { events: Record<string, number> };
    expect(saved.events.share).toBeGreaterThan(0);
    await boot();
  });
});
