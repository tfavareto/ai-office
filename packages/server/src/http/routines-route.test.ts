import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import { RESUMABLE_FILE } from '../terminal/resume';
import type { PtyProcess, PtySpawner } from '../terminal/service';
import {
  T0,
  type FakeClaudeDir,
  freePort,
  jsonl,
  makeFakeClaude,
  makeTempDir,
  removeDir,
  userLine,
} from '../test-helpers';

const SESSION = '11111111-2222-3333-4444-555555555555';

let fake: FakeClaudeDir;
let state: string;
let project: string;
let app: App;
let port: number;
let spawned: { args: readonly string[]; cwd: string }[];

const spawner: PtySpawner = (_file, args, _name, options) => {
  const pty: PtyProcess = {
    pid: 4242,
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    onData: () => undefined,
    onExit: () => undefined,
  };
  spawned.push({ args, cwd: options.cwd });
  return pty;
};

async function boot(env: NodeJS.ProcessEnv = {}): Promise<void> {
  port = await freePort();
  const web = join(state, 'web');
  const config = loadConfig(
    { HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...env },
    [],
    web,
  );
  app = createApp(config, silentLogger, {
    now: () => T0 + 60_000,
    pidAlive: () => true,
    version: '9.9.9',
    ptySpawner: spawner,
    env: { PATH: '/usr/bin', HOME: fake.home },
    hire: {
      launcher: { open: () => Promise.resolve('fake') },
      resolveClaude: () => '/fake/bin/claude',
      tmpDir: state,
    },
  });
  await app.start();
}

const url = (path: string): string => `http://127.0.0.1:${port}${path}`;
const headers = (): Record<string, string> => ({
  authorization: `Bearer ${app.context.auth.value}`,
  'content-type': 'application/json',
});
const post = (path: string, body: unknown = {}): Promise<Response> =>
  fetch(url(path), { method: 'POST', headers: headers(), body: JSON.stringify(body) });
const get = (path: string): Promise<Response> => fetch(url(path), { headers: headers() });
/** As if it came from another computer: fetch cannot set the Host header. */
function remote(method: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: { ...headers(), host: `192.168.1.20:${port}` },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}
const turnOn = (): Promise<Response> => post('/api/terminals/settings', { enabled: true });
const routine = (projectPath: string): Record<string, unknown> => ({
  name: 'Tests',
  prompt: 'Run the tests',
  projectPath,
  schedule: { kind: 'interval', minutes: 10 },
});

beforeEach(async () => {
  spawned = [];
  fake = await makeFakeClaude();
  state = await makeTempDir('ai-office-state-');
  project = await makeTempDir('ai-office-project-');
});
afterEach(async () => {
  await app.stop();
  await removeDir(fake.home);
  await removeDir(state);
  await removeDir(project);
});

describe('routines', () => {
  test('need the token', async () => {
    // Arrange
    await boot();

    // Act
    const response = await fetch(url('/api/routines'));

    // Assert
    expect(response.status).toBe(401);
  });

  test('are refused to anyone not on this computer, with the right token and all', async () => {
    // Arrange
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });

    // Act
    const statuses = await Promise.all(
      [
        ['GET', '/api/routines'],
        ['POST', '/api/routines'],
        ['POST', '/api/routines/x/enabled'],
        ['POST', '/api/routines/x/run'],
        ['POST', '/api/routines/x/remove'],
        ['GET', '/api/terminals/resumable'],
        ['POST', '/api/terminals/resumable/resume'],
        ['POST', '/api/terminals/resumable/dismiss'],
      ].map(([method, path]) => remote(method as string, path as string)),
    );

    // Assert
    expect(statuses).toEqual(statuses.map(() => 403));
    expect(spawned).toEqual([]);
  });

  test('refuse a folder that is not a room of the office', async () => {
    // Arrange
    await boot();

    // Act
    const response = await post('/api/routines', routine(project));

    // Assert
    expect(response.status).toBe(404);
    expect(spawned).toEqual([]);
  });

  test('refuse what would run too often', async () => {
    // Arrange
    await boot();

    // Act
    const response = await post('/api/routines', { ...routine(project), schedule: { kind: 'interval', minutes: 1 } });

    // Assert
    expect(response.status).toBe(400);
  });

  test('say so about an id that does not exist', async () => {
    // Arrange
    await boot();

    // Act
    const statuses = await Promise.all([
      post('/api/routines/nope/run'),
      post('/api/routines/nope/remove'),
      post('/api/routines/nope/enabled', { enabled: false }),
    ]);

    // Assert
    expect(statuses.map((response) => response.status)).toEqual([404, 404, 404]);
  });
});

describe('routines in demo mode', () => {
  test('show nothing of the real ones and change nothing', async () => {
    // Arrange
    const saved = { ...routine(project), id: 'real', enabled: true, nextRunAt: 1, history: [] };
    await writeFile(join(state, 'routines.json'), JSON.stringify({ version: 1, routines: [saved] }));
    await boot({ AI_OFFICE_DEMO: '1' });

    // Act
    const list = await (await get('/api/routines')).json();
    const statuses = await Promise.all([
      post('/api/routines', routine(project)),
      post('/api/routines/real/run'),
      post('/api/routines/real/remove'),
      post('/api/routines/real/enabled', { enabled: false }),
    ]);
    const file = JSON.parse(await readFile(join(state, 'routines.json'), 'utf8')) as { routines: { id: string }[] };

    // Assert
    expect(list).toEqual({ routines: [] });
    expect(statuses.map((response) => response.status)).toEqual([409, 409, 409, 409]);
    expect(file.routines.map((one) => one.id)).toEqual(['real']);
    expect(spawned).toEqual([]);
  });
});

describe('a routine in a room of the office', () => {
  async function bootWithRoom(): Promise<void> {
    await fake.writeRegistry(100, { sessionId: 's1', cwd: project, status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript('s1', jsonl(userLine('hi', 100, { cwd: project })), project);
    await boot();
    await app.context.engine.scan();
  }

  test('is saved, runs in a new real terminal, and survives a restart', async () => {
    // Arrange
    await bootWithRoom();
    await turnOn();

    // Act
    const created = await post('/api/routines', routine(project));
    const { routine: saved } = (await created.json()) as { routine: { id: string } };
    const run = await post(`/api/routines/${saved.id}/run`);
    const typed = spawned[0]?.args.join(' ');
    await vi.waitFor(async () => {
      const file = JSON.parse(await readFile(join(state, 'routines.json'), 'utf8')) as {
        routines: { history: unknown[] }[];
      };
      expect(file.routines[0]?.history).toHaveLength(1);
    });
    await app.stop();
    await boot();
    await app.context.engine.scan();
    const after = (await (await get('/api/routines')).json()) as { routines: { id: string }[] };

    // Assert
    expect(created.status).toBe(201);
    expect(run.status).toBe(200);
    expect(typed).toContain('Run the tests');
    expect(after.routines.map((one) => one.id)).toEqual([saved.id]);
  });

  test('with real terminals off, a run starts nothing', async () => {
    // Arrange
    await bootWithRoom();
    const { routine: saved } = (await (await post('/api/routines', routine(project))).json()) as {
      routine: { id: string };
    };

    // Act
    await post(`/api/routines/${saved.id}/run`);
    const list = (await (await get('/api/routines')).json()) as { routines: { history: { outcome: string }[] }[] };

    // Assert
    expect(spawned).toEqual([]);
    expect(list.routines[0]?.history[0]?.outcome).toBe('skipped-off');
  });

  test('can be paused and removed', async () => {
    // Arrange
    await bootWithRoom();
    const { routine: saved } = (await (await post('/api/routines', routine(project))).json()) as {
      routine: { id: string };
    };

    // Act
    const paused = await post(`/api/routines/${saved.id}/enabled`, { enabled: false });
    const invalid = await post(`/api/routines/${saved.id}/enabled`, { enabled: 'no' });
    const removed = await post(`/api/routines/${saved.id}/remove`);
    const list = await (await get('/api/routines')).json();

    // Assert
    expect([paused.status, invalid.status, removed.status]).toEqual([200, 400, 200]);
    expect(list).toEqual({ routines: [] });
  });
});

describe('terminals to resume', () => {
  const saved = (cwd: string): string =>
    JSON.stringify({
      version: 1,
      sessions: [{ sessionId: SESSION, cwd, role: 'Revisor', roleInstructions: 'Be brief' }],
    });

  test('offer nothing while real terminals are off, and keep the list', async () => {
    // Arrange
    await writeFile(join(state, RESUMABLE_FILE), saved(project));
    await boot();

    // Act
    const before = await (await get('/api/terminals/resumable')).json();
    await turnOn();
    const after = await (await get('/api/terminals/resumable')).json();

    // Assert
    expect(before).toEqual({ sessions: [] });
    expect(after).toEqual({ sessions: [{ sessionId: SESSION, cwd: project, role: 'Revisor' }] });
  });

  test('never hand the instructions to the page', async () => {
    // Arrange
    await writeFile(join(state, RESUMABLE_FILE), saved(project));
    await boot();
    await turnOn();

    // Act
    const text = await (await get('/api/terminals/resumable')).text();

    // Assert
    expect(text).not.toContain('Be brief');
    expect(text).not.toContain('configDir');
  });

  test('start Claude Code on that session, once', async () => {
    // Arrange
    await writeFile(join(state, RESUMABLE_FILE), saved(project));
    await boot();
    await turnOn();

    // Act
    const first = await post('/api/terminals/resumable/resume', { sessionId: SESSION });
    const second = await post('/api/terminals/resumable/resume', { sessionId: SESSION });

    // Assert
    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.args.slice(-2)).toEqual(['--resume', SESSION]);
    expect(spawned[0]?.args[0]).toBe('--append-system-prompt');
    expect(spawned[0]?.args[1]).toContain('Your role here is Revisor.\nBe brief');
    expect(spawned[0]?.args[1]).toContain('peers.mjs');
  });

  test('a double click runs one conversation in one terminal', async () => {
    // Arrange
    await writeFile(join(state, RESUMABLE_FILE), saved(project));
    await boot();
    await turnOn();

    // Act
    const statuses = await Promise.all([
      post('/api/terminals/resumable/resume', { sessionId: SESSION }),
      post('/api/terminals/resumable/resume', { sessionId: SESSION }),
    ]);

    // Assert
    expect(statuses.map((response) => response.status).sort()).toContain(200);
    expect(spawned).toHaveLength(1);
  });

  test('refuse an account folder that is no longer an account', async () => {
    // Arrange
    const session = { sessionId: SESSION, cwd: project, configDir: join(state, 'hooks-here') };
    await writeFile(join(state, RESUMABLE_FILE), JSON.stringify({ version: 1, sessions: [session] }));
    await boot();
    await turnOn();

    // Act
    const response = await post('/api/terminals/resumable/resume', { sessionId: SESSION });

    // Assert
    expect(response.status).toBe(400);
    expect(spawned).toEqual([]);
  });

  test('offer nothing in demo mode', async () => {
    // Arrange
    await writeFile(join(state, RESUMABLE_FILE), saved(project));
    await boot({ AI_OFFICE_DEMO: '1' });
    await turnOn();

    // Act
    const list = await (await get('/api/terminals/resumable')).json();

    // Assert
    expect(list).toEqual({ sessions: [] });
  });

  test('refuse a session the office did not save: a page cannot choose what to run', async () => {
    // Arrange
    await writeFile(join(state, RESUMABLE_FILE), saved(project));
    await boot();
    await turnOn();

    // Act
    const unknown = await post('/api/terminals/resumable/resume', { sessionId: '--dangerously-skip-permissions' });

    // Assert
    expect(unknown.status).toBe(404);
    expect(spawned).toEqual([]);
  });

  test('refuse to resume while the setting is off, and keep the session on the list', async () => {
    // Arrange
    await writeFile(join(state, RESUMABLE_FILE), saved(project));
    await boot();

    // Act
    const response = await post('/api/terminals/resumable/resume', { sessionId: SESSION });
    await turnOn();
    const list = (await (await get('/api/terminals/resumable')).json()) as { sessions: unknown[] };

    // Assert
    expect(response.status).toBe(409);
    expect(spawned).toEqual([]);
    expect(list.sessions).toHaveLength(1);
  });

  test('can be dismissed', async () => {
    // Arrange
    await writeFile(join(state, RESUMABLE_FILE), saved(project));
    await boot();
    await turnOn();

    // Act
    await post('/api/terminals/resumable/dismiss');
    const list = await (await get('/api/terminals/resumable')).json();

    // Assert
    expect(list).toEqual({ sessions: [] });
  });
});
