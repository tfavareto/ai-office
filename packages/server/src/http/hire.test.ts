import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { HireCheckResponse, HireResponse } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import {
  assistantLine,
  freePort,
  jsonl,
  makeFakeClaude,
  makeTempDir,
  removeDir,
  text,
  userLine,
  type FakeClaudeDir,
} from '../test-helpers';
import type { TerminalLauncher } from '../hire/terminals';

let fake: FakeClaudeDir;
let state: string;
let web: string;
let tmp: string;
let project: string;
let app: App;
let base: string;
let port: number;
let scripts: string[];

async function boot(extraEnv: NodeJS.ProcessEnv = {}, claude: string | null = '/fake/bin/claude'): Promise<void> {
  port = await freePort();
  const launcher: TerminalLauncher = {
    open: async (scriptPath) => {
      scripts.push(await readFile(scriptPath, 'utf8'));
      return 'Fake';
    },
  };
  const config = loadConfig(
    { HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...extraEnv },
    [],
    web,
  );
  app = createApp(config, silentLogger, {
    pidAlive: () => true,
    version: '9.9.9',
    hire: { launcher, resolveClaude: () => claude ?? undefined, tmpDir: tmp },
  });
  await app.start();
  base = `http://127.0.0.1:${port}`;
}

beforeEach(async () => {
  scripts = [];
  fake = await makeFakeClaude();
  state = await makeTempDir('ai-office-state-');
  web = join(await makeTempDir('ai-office-web-'), 'dist');
  tmp = await makeTempDir('ai-office-launchers-');
  project = await realpath(await makeTempDir('ai-office-project-'));
});
afterEach(async () => {
  await app.stop();
  for (const dir of [fake.home, state, join(web, '..'), tmp, project]) await removeDir(dir);
});

const apiFetch = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${app.context.auth.value}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
const hire = (body: unknown): Promise<Response> =>
  apiFetch('/api/agents/hire', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const until = async (check: () => boolean, ms = 10_000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('POST /api/agents/hire', () => {
  test('answers 202 with the pending hire, opens the terminal once and shows the placeholder in the snapshot', async () => {
    await boot();

    const response = await hire({ projectPath: project, prompt: 'Add a login page', model: 'sonnet', deskIndex: 2 });

    expect(response.status).toBe(202);
    const { hire: created } = (await response.json()) as HireResponse;
    expect(created).toMatchObject({ projectId: project, accountId: 'claude', deskIndex: 2 });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(`cd -- '${project}'`);
    expect(scripts[0]).toContain("'--model' 'sonnet' 'Add a login page'");
    expect(app.context.snapshots.build().hires).toEqual([created]);
  });

  test('the placeholder is handed over when the session shows up in the folder', async () => {
    await fake.writeRegistry(900, { sessionId: 'old', cwd: project, startedAt: Date.now() - 600_000, status: 'idle' });
    await fake.writeTranscript('old', jsonl(userLine('hi', -600_000), assistantLine([text('ok')], -599_000)), project);
    await boot();
    await app.context.engine.scan();
    const { hire: created } = (await (await hire({ projectPath: project })).json()) as HireResponse;

    await fake.writeRegistry(901, { sessionId: 'fresh', cwd: project, startedAt: Date.now() + 200, status: 'idle' });
    await fake.writeTranscript('fresh', jsonl(userLine('hello', 0)), project);
    await app.context.engine.scan();

    await until(() => app.context.snapshots.build().hires?.[0]?.agentId !== undefined);
    expect(app.context.snapshots.build().hires?.[0]).toMatchObject({ id: created.id, agentId: 'claude:fresh' });
  });

  test('validates the body before doing anything', async () => {
    await boot();

    for (const [body, error] of [
      [{}, 'invalid-projectPath'],
      [{ projectPath: project, model: 'gpt' }, 'invalid-model'],
      [{ projectPath: project, permissionMode: 'bypassPermissions' }, 'invalid-permissionMode'],
      [{ projectPath: project, prompt: 'x'.repeat(8001) }, 'invalid-prompt'],
      [{ projectPath: project, accountId: 'ghost' }, 'unknown-account'],
      [{ projectPath: 'relative' }, 'invalid-projectPath'],
    ] as const) {
      const response = await hire(body);
      expect([response.status, ((await response.json()) as { error: string }).error], JSON.stringify(body)).toEqual([
        400,
        error,
      ]);
    }
    expect(scripts).toHaveLength(0);
  });

  test('answers 404 for a missing folder and 400 for a file', async () => {
    await boot();
    await writeFile(join(project, 'file.txt'), 'x');

    const missing = await hire({ projectPath: join(project, 'nope') });
    const file = await hire({ projectPath: join(project, 'file.txt') });

    expect([missing.status, ((await missing.json()) as { error: string }).error]).toEqual([404, 'project-not-found']);
    expect([file.status, ((await file.json()) as { error: string }).error]).toEqual([400, 'project-not-directory']);
  });

  test('answers 503 when claude is not installed', async () => {
    await boot({}, null);

    const response = await hire({ projectPath: project });

    expect([response.status, ((await response.json()) as { error: string }).error]).toEqual([503, 'claude-not-found']);
  });

  test('allows five launches a minute', async () => {
    await boot();

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await hire({ projectPath: project })).status);

    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    expect(scripts).toHaveLength(5);
  });

  test('requires the token, JSON and a same-origin request', async () => {
    await boot();
    const body = JSON.stringify({ projectPath: project });

    expect(
      (
        await fetch(`${base}/api/agents/hire`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (await apiFetch('/api/agents/hire', { method: 'POST', headers: { 'content-type': 'text/plain' }, body })).status,
    ).toBe(415);
    expect(
      (
        await apiFetch('/api/agents/hire', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
          body,
        })
      ).status,
    ).toBe(403);
    expect((await apiFetch('/api/agents/hire', { method: 'GET' })).status).toBe(404);
    expect(scripts).toHaveLength(0);
  });

  test('is local-only: a request that does not come from this computer is refused', async () => {
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });

    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/agents/hire',
          method: 'POST',
          headers: {
            host: `192.168.1.20:${port}`,
            'content-type': 'application/json',
            authorization: `Bearer ${app.context.auth.value}`,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ projectPath: project }));
    });

    expect(status).toBe(403);
    expect(scripts).toHaveLength(0);
  });

  test('demo mode simulates the hire: no terminal, and a placeholder in a demo room', async () => {
    await boot();
    app.context.setDemo(true);

    const response = await hire({
      projectPath: '/Users/demo/projetos/loja-online',
      accountId: 'demo-trabalho',
      prompt: 'Revisar',
    });

    expect(response.status).toBe(202);
    expect(scripts).toHaveLength(0);
    expect(app.context.snapshots.build().hires?.[0]).toMatchObject({
      demo: true,
      projectId: '/Users/demo/projetos/loja-online',
      accountId: 'demo-trabalho',
    });
  });
});

describe('GET /api/agents/hire/check', () => {
  test('tells whether a folder can host an agent', async () => {
    await boot();
    const check = async (path: string): Promise<HireCheckResponse> =>
      (await (await apiFetch(`/api/agents/hire/check?path=${encodeURIComponent(path)}`)).json()) as HireCheckResponse;

    expect(await check(project)).toEqual({ ok: true });
    expect(await check(join(project, 'nope'))).toEqual({ ok: false, reason: 'not-found' });
    expect(await check('relative')).toEqual({ ok: false, reason: 'not-absolute' });
    expect(await check(join(fake.home, '.claude', 'sessions'))).toEqual({ ok: true });
  });

  test('needs a path, the token and local access', async () => {
    await boot();
    await mkdir(join(project, 'x'));

    expect((await apiFetch('/api/agents/hire/check')).status).toBe(400);
    expect((await fetch(`${base}/api/agents/hire/check?path=${encodeURIComponent(project)}`)).status).toBe(401);
  });
});
