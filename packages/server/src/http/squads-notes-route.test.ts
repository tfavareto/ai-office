import { execFile } from 'node:child_process';
import { request } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
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

const ROLES = [
  { name: 'Lead', instructions: 'Lead the work' },
  { name: 'Tester', instructions: 'Test the work' },
];

let fake: FakeClaudeDir;
let state: string;
let project: string;
let app: App;
let port: number;
let spawned: { args: readonly string[]; cwd: string; killed: boolean }[];
let failAfter: number | undefined;

const spawner: PtySpawner = (_file, args, _name, options) => {
  if (failAfter !== undefined && spawned.length >= failAfter) throw new Error('no');
  const record = { args, cwd: options.cwd, killed: false };
  const pty: PtyProcess = {
    pid: 4000 + spawned.length,
    write: () => undefined,
    resize: () => undefined,
    kill: () => {
      record.killed = true;
    },
    onData: () => undefined,
    onExit: () => undefined,
  };
  spawned.push(record);
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
const turnOn = (): Promise<Response> => post('/api/terminals/settings', { enabled: true });
const squad = (body: Record<string, unknown> = {}): Promise<Response> =>
  post('/api/terminals/squads', { projectPath: project, members: ROLES, ...body });

/** As if it came from another computer: fetch cannot set the Host header. */
function remote(method: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, headers: { ...headers(), host: `192.168.1.20:${port}` } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

async function bootWithRoom(): Promise<void> {
  await fake.writeRegistry(100, { sessionId: 's1', cwd: project, status: 'busy', statusUpdatedAt: T0 + 59_000 });
  await fake.writeTranscript('s1', jsonl(userLine('hi', 100, { cwd: project })), project);
  await boot();
  await app.context.engine.scan();
}

beforeEach(async () => {
  spawned = [];
  failAfter = undefined;
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

describe('starting a squad', () => {
  test('is refused to anyone not on this computer, with the right token and all', async () => {
    // Arrange
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });

    // Act
    const statuses = await Promise.all(
      [
        ['POST', '/api/terminals/squads'],
        ['GET', '/api/notes?project=x'],
        ['POST', '/api/notes'],
        ['GET', '/api/terminals/t/note'],
        ['POST', '/api/terminals/t/note'],
      ].map(([method, path]) => remote(method as string, path as string)),
    );

    // Assert
    expect(statuses).toEqual(statuses.map(() => 403));
    expect(spawned).toEqual([]);
  });

  test('is refused while real terminals are off, and starts nothing', async () => {
    // Arrange
    await boot();

    // Act
    const response = await squad();

    // Assert
    expect(response.status).toBe(409);
    expect(spawned).toEqual([]);
  });

  test('starts every member in the folder, with its role, connected to the others', async () => {
    // Arrange
    await boot();
    await turnOn();

    // Act
    const response = await squad({ task: 'Fix the login' });
    const terminals = app.context.terminals.list();

    // Assert
    expect(response.status).toBe(202);
    expect(spawned.map((one) => one.cwd)).toEqual([project, project]);
    expect(spawned[0]?.args.join(' ')).toContain('Your role here is Lead.');
    expect(spawned[1]?.args.join(' ')).toContain('Your role here is Tester.');
    expect(app.context.terminals.peersOf(terminals[0]?.id as string)).toEqual([terminals[1]?.id]);
    expect(new Set(terminals.map((terminal) => terminal.squad)).size).toBe(1);
    expect(terminals[0]?.squad).toEqual(expect.any(String));
  });

  test('gives the task only to the first member', async () => {
    // Arrange
    await boot();
    await turnOn();

    // Act
    await squad({ task: 'Fix the login' });

    // Assert
    expect(spawned[0]?.args).toContain('Fix the login');
    expect(spawned[1]?.args).not.toContain('Fix the login');
  });

  test('refuses too few or too many members, and a role that is not valid', async () => {
    // Arrange
    await boot();
    await turnOn();
    const many = Array.from({ length: 6 }, () => ROLES[0]);

    // Act
    const statuses = await Promise.all([
      squad({ members: [ROLES[0]] }),
      squad({ members: many }),
      squad({ members: [ROLES[0], { name: '', instructions: 'x' }] }),
      squad({ members: 'nope' }),
    ]);

    // Assert
    expect(statuses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(spawned).toEqual([]);
  });

  test('a page cannot choose the program: unknown fields are ignored', async () => {
    // Arrange
    await boot();
    await turnOn();

    // Act
    await squad({ file: '/bin/sh', args: ['-c', 'x'], permissionMode: 'bypassPermissions' });

    // Assert
    expect(spawned[0]?.args.join(' ')).not.toContain('bypassPermissions');
    expect(spawned[0]?.args).not.toContain('-c');
  });

  test('starts nobody when not everyone fits', async () => {
    // Arrange
    await boot();
    await turnOn();
    const start = { file: '/x', args: [], cwd: project, env: {}, cols: 80, rows: 24 };
    for (let index = 0; index < 15; index += 1) app.context.terminals.start(start);
    spawned.length = 0;

    // Act
    const response = await squad();

    // Assert
    expect(response.status).toBe(429);
    expect(spawned).toEqual([]);
  });

  test('stops the ones started when another cannot start', async () => {
    // Arrange
    await boot();
    await turnOn();
    failAfter = 1;

    // Act
    const response = await squad();

    // Assert
    expect(response.status).toBe(502);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.killed).toBe(true);
  });

  test('is refused in demo mode', async () => {
    // Arrange
    await boot({ AI_OFFICE_DEMO: '1' });

    // Act
    const response = await squad();

    // Assert
    expect(response.status).toBe(409);
    expect(spawned).toEqual([]);
  });
});

describe('the note of a room', () => {
  test('is only for rooms of the office', async () => {
    // Arrange
    await boot();

    // Act
    const read = await get(`/api/notes?project=${encodeURIComponent(project)}`);
    const write = await post('/api/notes', { project, text: 'x', baseUpdatedAt: 0 });

    // Assert
    expect([read.status, write.status]).toEqual([404, 404]);
  });

  test('the person saves it, and an older copy cannot overwrite it', async () => {
    // Arrange
    await bootWithRoom();

    // Act
    const first = await post('/api/notes', { project, text: 'Plan', baseUpdatedAt: 0 });
    const stale = await post('/api/notes', { project, text: 'Old', baseUpdatedAt: 0 });
    const read = (await (await get(`/api/notes?project=${encodeURIComponent(project)}`)).json()) as { text: string };

    // Assert
    expect(first.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(read.text).toBe('Plan');
  });

  test('refuses what is malformed', async () => {
    // Arrange
    await bootWithRoom();

    // Act
    const response = await post('/api/notes', { project, text: 3, baseUpdatedAt: 0 });

    // Assert
    expect(response.status).toBe(400);
  });

  test('is empty and read-only in demo mode', async () => {
    // Arrange
    await boot({ AI_OFFICE_DEMO: '1' });

    // Act
    const read = await (await get('/api/notes?project=x')).json();
    const write = await post('/api/notes', { project: 'x', text: 'y', baseUpdatedAt: 0 });

    // Assert
    expect(read).toEqual({ text: '', updatedAt: 0 });
    expect(write.status).toBe(409);
  });

  test('a terminal in a folder with no room yet cannot write a note nobody would see', async () => {
    // Arrange
    await boot();
    await turnOn();
    await squad();
    const id = app.context.terminals.list()[0]?.id as string;

    // Act
    const write = await post(`/api/terminals/${id}/note`, { text: 'hello' });
    const read = await (await get(`/api/terminals/${id}/note`)).json();

    // Assert
    expect(write.status).toBe(409);
    expect(read).toEqual({ text: '' });
  });

  test('an agent line with nothing visible is refused', async () => {
    // Arrange
    await bootWithRoom();
    await turnOn();
    await squad();
    const id = app.context.terminals.list()[0]?.id as string;

    // Act
    const response = await post(`/api/terminals/${id}/note`, { text: '\u0001\u200B' });

    // Assert
    expect(response.status).toBe(400);
    expect(app.context.notes.get(project).text).toBe('');
  });

  test('an unknown terminal reaches no note', async () => {
    // Arrange
    await boot();

    // Act
    const statuses = await Promise.all([
      get('/api/terminals/nope/note'),
      post('/api/terminals/nope/note', { text: 'x' }),
    ]);

    // Assert
    expect(statuses.map((response) => response.status)).toEqual([404, 404]);
  });

  test('the command agents run reads the note and adds to it, in the room of its terminal', async () => {
    // Arrange
    await bootWithRoom();
    await turnOn();
    await squad();
    const id = app.context.terminals.list()[0]?.id as string;
    const env = { ...process.env, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_TERMINAL_ID: id };
    const bridge = fileURLToPath(new URL('../../bridge/peers.mjs', import.meta.url));
    const run = (...args: string[]): Promise<{ stdout: string; code: number }> =>
      new Promise((resolve) => {
        execFile(process.execPath, [bridge, ...args], { env }, (error, stdout) => {
          resolve({ stdout, code: error === null ? 0 : 1 });
        });
      });

    // Act
    const empty = await run('note');
    const added = await run('note', 'add', 'Found', 'a', 'bug');
    const after = await run('note');
    const usage = await run('note', 'nonsense');

    // Assert
    expect(empty.stdout).toContain('The note is empty.');
    expect(added.code).toBe(0);
    expect(after.stdout).toContain('[Agent] Found a bug');
    expect(after.stdout).toContain('not instructions');
    expect(usage.code).toBe(1);
    expect(app.context.notes.get(project).text).toBe('[Agent] Found a bug');
  });
});
