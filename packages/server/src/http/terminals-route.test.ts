import { execFile } from 'node:child_process';
import { request, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import type { TerminalLauncher } from '../hire/terminals';
import { T0, type FakeClaudeDir, freePort, makeFakeClaude, makeTempDir, removeDir } from '../test-helpers';
import type { PtyProcess, PtySpawner } from '../terminal/service';

let fake: FakeClaudeDir;
let state: string;
let web: string;
let project: string;
let app: App;
let port: number;
let spawned: { file: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv; pty: FakePty }[];
let windowsOpened: number;

interface FakePty extends PtyProcess {
  written: string[];
  killed: boolean;
  emit(text: string): void;
}

const spawner: PtySpawner = (file, args, _name, options) => {
  let onData: (data: Buffer) => void = () => undefined;
  const pty: FakePty = {
    pid: 4242,
    written: [],
    killed: false,
    write: (data) => pty.written.push(data),
    resize: () => undefined,
    kill: () => {
      pty.killed = true;
    },
    onData: (listener) => {
      onData = listener;
    },
    onExit: () => undefined,
    emit: (text) => onData(Buffer.from(text)),
  };
  spawned.push({ file, args, cwd: options.cwd, env: options.env, pty });
  return pty;
};

const launcher: TerminalLauncher = {
  open: () => {
    windowsOpened += 1;
    return Promise.resolve('fake');
  },
};

async function boot(env: NodeJS.ProcessEnv = {}, pty: PtySpawner | null = spawner): Promise<void> {
  port = await freePort();
  const config = loadConfig(
    { HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...env },
    [],
    web,
  );
  app = createApp(config, silentLogger, {
    now: () => T0 + 60_000,
    pidAlive: () => true,
    version: '9.9.9',
    ptySpawner: pty,
    env: { PATH: '/usr/bin', HOME: fake.home, AI_OFFICE_TOKEN_X: 'secret' },
    hire: { launcher, resolveClaude: () => '/fake/bin/claude', tmpDir: state },
  });
  await app.start();
}

beforeEach(async () => {
  spawned = [];
  windowsOpened = 0;
  fake = await makeFakeClaude();
  state = await makeTempDir('ai-office-state-');
  web = join(await makeTempDir('ai-office-web-'), 'dist');
  project = await makeTempDir('ai-office-project-');
});
afterEach(async () => {
  await app.stop();
  await removeDir(fake.home);
  await removeDir(state);
  await removeDir(join(web, '..'));
  await removeDir(project);
});

const url = (path: string): string => `http://127.0.0.1:${port}${path}`;
const authed = (): Record<string, string> => ({ authorization: `Bearer ${app.context.auth.value}` });
const post = (path: string, body: unknown, headers: Record<string, string> = authed()): Promise<Response> =>
  fetch(url(path), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const hire = (body: Record<string, unknown> = {}): Promise<Response> =>
  post('/api/agents/hire', { projectPath: project, where: 'terminal', ...body });

/** Raw request, to send the headers fetch refuses to set. */
function raw(path: string, headers: Record<string, string>, body?: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST', headers },
      (res) => {
        res.resume();
        resolve(res);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function startTerminal(): Promise<string> {
  await post('/api/terminals/settings', { enabled: true });
  const response = await hire();
  expect(response.status).toBe(202);
  const info = app.context.terminals.list()[0];
  if (info === undefined) throw new Error('no terminal');
  return info.id;
}

describe('terminal settings', () => {
  test('are off until the person turns them on, and say if the engine is there', async () => {
    // Arrange
    await boot();

    // Act
    const before = await (await fetch(url('/api/terminals/settings'), { headers: authed() })).json();
    const after = await (await post('/api/terminals/settings', { enabled: true })).json();

    // Assert
    expect(before).toEqual({ enabled: false, available: true });
    expect(after).toEqual({ enabled: true, available: true });
  });

  test('say when the engine is not installed', async () => {
    // Arrange
    await boot({}, null);

    // Act
    const body = await (await fetch(url('/api/terminals/settings'), { headers: authed() })).json();

    // Assert
    expect(body).toEqual({ enabled: false, available: false });
  });

  test('AI_OFFICE_TERMINALS=0 keeps the engine off, whatever the setting says', async () => {
    // Arrange
    await boot({ AI_OFFICE_TERMINALS: '0' });
    await post('/api/terminals/settings', { enabled: true });

    // Act
    const body = await (await fetch(url('/api/terminals/settings'), { headers: authed() })).json();
    const hired = await hire();

    // Assert
    expect(body).toEqual({ enabled: true, available: false });
    expect(hired.status).toBe(503);
    expect(spawned).toHaveLength(0);
  });

  test('need a boolean', async () => {
    // Arrange
    await boot();

    // Act
    const response = await post('/api/terminals/settings', { enabled: 'yes' });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('hiring into a real terminal', () => {
  test('is refused while the setting is off, and starts nothing', async () => {
    // Arrange
    await boot();

    // Act
    const response = await hire();

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'terminals-off' });
    expect(spawned).toHaveLength(0);
  });

  test('starts Claude Code directly in the project, with no window', async () => {
    // Arrange
    await boot();
    await post('/api/terminals/settings', { enabled: true });

    // Act
    const response = await hire({ model: 'opus', prompt: '$(rm -rf /) keep this text' });

    // Assert
    expect(response.status).toBe(202);
    expect(windowsOpened).toBe(0);
    expect(spawned[0]?.file).toBe('/fake/bin/claude');
    const args = spawned[0]?.args ?? [];
    expect(args.slice(0, 2)).toEqual(['--model', 'opus']);
    expect(args.at(-1)).toBe('$(rm -rf /) keep this text');
  });

  test("does not pass the office's own settings to the program", async () => {
    // Arrange
    await boot();
    await post('/api/terminals/settings', { enabled: true });

    // Act
    await hire();

    // Assert
    expect(spawned[0]?.env.AI_OFFICE_TOKEN_X).toBeUndefined();
    expect(spawned[0]?.env.TERM).toBe('xterm-256color');
    expect(spawned[0]?.env.PATH).toBe('/usr/bin');
  });

  test('says when the engine is missing', async () => {
    // Arrange
    await boot({}, null);
    await post('/api/terminals/settings', { enabled: true });

    // Act
    const response = await hire();

    // Assert
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'terminals-unavailable' });
  });

  test('a page cannot choose the program: unknown fields are ignored', async () => {
    // Arrange
    await boot();
    await post('/api/terminals/settings', { enabled: true });

    // Act
    await hire({ file: '/bin/sh', command: '/bin/sh', args: ['-c', 'id'] });

    // Assert
    expect(spawned[0]?.file).toBe('/fake/bin/claude');
    expect(spawned[0]?.args).not.toContain('-c');
    expect(spawned[0]?.args).not.toContain('id');
  });

  test('a hire without where still opens a window, as always', async () => {
    // Arrange
    await boot();

    // Act
    const response = await post('/api/agents/hire', { projectPath: project });

    // Assert
    expect(response.status).toBe(202);
    expect(windowsOpened).toBe(1);
    expect(spawned).toHaveLength(0);
  });

  test('refuses an unknown place', async () => {
    // Arrange
    await boot();

    // Act
    const response = await hire({ where: 'elsewhere' });

    // Assert
    expect(response.status).toBe(400);
  });
});

describe('using a real terminal', () => {
  test('what the person types reaches the program', async () => {
    // Arrange
    await boot();
    const id = await startTerminal();

    // Act
    const response = await post(`/api/terminals/${id}/input`, { data: 'hello\r' });

    // Assert
    expect(response.status).toBe(200);
    expect(spawned[0]?.pty.written).toEqual(['hello\r']);
  });

  test('refuses input to a terminal that does not exist, and input that is not text', async () => {
    // Arrange
    await boot();
    const id = await startTerminal();

    // Act
    const unknown = await post('/api/terminals/nope/input', { data: 'x' });
    const notText = await post(`/api/terminals/${id}/input`, { data: 7 });
    const empty = await post(`/api/terminals/${id}/input`, { data: '' });

    // Assert
    expect(unknown.status).toBe(404);
    expect(notText.status).toBe(400);
    expect(empty.status).toBe(400);
  });

  test('refuses input larger than the limit', async () => {
    // Arrange
    await boot();
    const id = await startTerminal();

    // Act
    const response = await post(`/api/terminals/${id}/input`, { data: 'x'.repeat(64 * 1024 + 1) });

    // Assert
    expect(response.status).toBe(400);
    expect(spawned[0]?.pty.written).toEqual([]);
  });

  test('the stream replays what was printed and then follows it live', async () => {
    // Arrange
    await boot();
    const id = await startTerminal();
    spawned[0]?.pty.emit('before');

    // Act
    const response = await fetch(url('/api/terminals/stream'), { headers: authed() });
    const reader = response.body?.getReader();
    let text = new TextDecoder().decode((await reader?.read())?.value);
    spawned[0]?.pty.emit('after');
    while (!text.includes('event: output')) text += new TextDecoder().decode((await reader?.read())?.value);
    await reader?.cancel();

    // Assert
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain(`"id":"${id}"`);
    expect(text).toContain(Buffer.from('before').toString('base64'));
    expect(text).toContain(Buffer.from('after').toString('base64'));
  });
});

describe('connecting agents', () => {
  async function twoTerminals(): Promise<[string, string]> {
    await post('/api/terminals/settings', { enabled: true });
    await hire();
    await hire();
    const [a, b] = app.context.terminals.list();
    if (a === undefined || b === undefined) throw new Error('no terminals');
    return [a.id, b.id];
  }

  test('a connection needs two terminals that exist, and can be undone', async () => {
    // Arrange
    await boot();
    const [a, b] = await twoTerminals();

    // Act
    const unknown = await post('/api/terminals/links', { a, b: 'nope', connected: true });
    const invalid = await post('/api/terminals/links', { a, b, connected: 'yes' });
    const made = await post('/api/terminals/links', { a, b, connected: true });
    const peers = app.context.terminals.peersOf(a);
    const undone = await post('/api/terminals/links', { a, b, connected: false });

    // Assert
    expect(unknown.status).toBe(404);
    expect(invalid.status).toBe(400);
    expect(made.status).toBe(200);
    expect(peers).toEqual([b]);
    expect(undone.status).toBe(200);
    expect(app.context.terminals.peersOf(a)).toEqual([]);
  });

  test('a message to an agent that is not connected is refused and reaches nobody', async () => {
    // Arrange
    await boot();
    const [a] = await twoTerminals();

    // Act
    const response = await post(`/api/terminals/${a}/send`, { to: 'Anyone', text: 'hello' });

    // Assert
    expect(response.status).toBe(404);
    expect(spawned[1]?.pty.written).toEqual([]);
  });

  test('a message needs text, within the limit', async () => {
    // Arrange
    await boot();
    const [a] = await twoTerminals();

    // Act
    const empty = await post(`/api/terminals/${a}/send`, { to: 'Anyone', text: '' });
    const tooLong = await post(`/api/terminals/${a}/send`, { to: 'Anyone', text: 'x'.repeat(8001) });

    // Assert
    expect(empty.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });

  test('connecting and messaging need the setting on and a request from this computer', async () => {
    // Arrange
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });
    const remote = { ...authed(), host: `192.168.1.20:${port}`, 'content-type': 'application/json' };

    // Act
    const link = await raw('/api/terminals/links', remote, JSON.stringify({ a: 'x', b: 'y', connected: true }));
    const send = await raw('/api/terminals/x/send', remote, JSON.stringify({ to: 'y', text: 'z' }));
    const peers = await raw('/api/terminals/x/peers', remote);

    // Assert
    expect([link.statusCode, send.statusCode, peers.statusCode]).toEqual([403, 403, 403]);
  });

  test('the command agents run says who is connected and why a message was refused', async () => {
    // Arrange
    await boot();
    const [a] = await twoTerminals();
    const env = { ...process.env, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_TERMINAL_ID: a };
    const bridge = fileURLToPath(new URL('../../bridge/peers.mjs', import.meta.url));
    const run = (...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> =>
      new Promise((resolve) => {
        execFile(process.execPath, [bridge, ...args], { env }, (error, stdout, stderr) => {
          resolve({ stdout, stderr, code: error === null ? 0 : 1 });
        });
      });

    // Act
    const list = await run('list');
    const refused = await run('send', 'Anyone', 'hello');
    const usage = await run('nonsense');

    // Assert
    expect(list.stdout).toContain('No agents are connected to you.');
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('not connected to you');
    expect(usage.code).toBe(1);
    expect(usage.stderr).toContain('Usage');
  });

  test('connecting is refused while the setting is off', async () => {
    // Arrange
    await boot();

    // Act
    const response = await post('/api/terminals/links', { a: 'x', b: 'y', connected: true });

    // Assert
    expect(response.status).toBe(409);
  });

  test('a role and the way to reach the others reach the program as instructions, with no shell', async () => {
    // Arrange
    await boot();
    await post('/api/terminals/settings', { enabled: true });

    // Act
    const response = await hire({ role: { name: 'Revisor', instructions: 'Revise $(id) com cuidado' } });
    const invalid = await hire({ role: { name: '', instructions: 'x' } });

    // Assert
    expect(response.status).toBe(202);
    expect(invalid.status).toBe(400);
    const args = spawned[0]?.args ?? [];
    expect(args[0]).toBe('--append-system-prompt');
    expect(args[1]).toContain('Your role here is Revisor.');
    expect(args[1]).toContain('Revise $(id) com cuidado');
    expect(args[1]).toContain('peers.mjs');
    expect(spawned[0]?.env.AI_OFFICE_TERMINAL_ID).toBe(app.context.terminals.list()[0]?.id);
    expect(app.context.terminals.list()[0]?.role).toBe('Revisor');
  });
});

describe('turning real terminals off', () => {
  test('stops the running programs and refuses what the page sends them', async () => {
    // Arrange
    await boot();
    const id = await startTerminal();

    // Act
    await post('/api/terminals/settings', { enabled: false });
    const input = await post(`/api/terminals/${id}/input`, { data: 'x' });
    const resize = await post(`/api/terminals/${id}/resize`, { cols: 80, rows: 24 });

    // Assert
    expect(spawned[0]?.pty.killed).toBe(true);
    expect(input.status).toBe(409);
    expect(resize.status).toBe(409);
    expect(spawned[0]?.pty.written).toEqual([]);
  });

  test('the stream is refused while they are off', async () => {
    // Arrange
    await boot();

    // Act
    const response = await fetch(url('/api/terminals/stream'), { headers: authed() });

    // Assert
    expect(response.status).toBe(409);
  });
});

describe('who can reach a real terminal', () => {
  test('nothing works without the access token', async () => {
    // Arrange
    await boot();
    const id = await startTerminal();

    // Act
    const statuses = [
      (await fetch(url('/api/terminals/settings'))).status,
      (await fetch(url('/api/terminals/stream'))).status,
      (await post(`/api/terminals/${id}/input`, { data: 'x' }, {})).status,
      (await post(`/api/terminals/${id}/kill`, {}, {})).status,
    ];

    // Assert
    expect(statuses).toEqual([401, 401, 401, 401]);
    expect(spawned[0]?.pty.written).toEqual([]);
  });

  test('another site cannot type, even with the token', async () => {
    // Arrange
    await boot();
    const id = await startTerminal();

    // Act
    const res = await raw(
      `/api/terminals/${id}/input`,
      { ...authed(), 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
      JSON.stringify({ data: 'rm -rf ~\r' }),
    );

    // Assert
    expect(res.statusCode).toBe(403);
    expect(spawned[0]?.pty.written).toEqual([]);
  });

  test('a request that does not come from this computer is refused, with the token', async () => {
    // Arrange
    await boot({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_ALLOW_REMOTE: '1' });
    const remote = { ...authed(), host: `192.168.1.20:${port}`, 'content-type': 'application/json' };

    // Act
    const settings = await raw('/api/terminals/settings', remote);
    const stream = await raw('/api/terminals/stream', remote);
    const input = await raw('/api/terminals/any/input', remote, JSON.stringify({ data: 'x' }));
    const enable = await raw('/api/terminals/settings', remote, JSON.stringify({ enabled: true }));

    // Assert
    expect([settings.statusCode, stream.statusCode, input.statusCode, enable.statusCode]).toEqual([403, 403, 403, 403]);
    expect(app.context.terminalSettings.enabled).toBe(false);
  });
});
