// End to end: the customization endpoints, over real HTTP like the page uses them, and what they do to the snapshot.
import { request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { messageDraft, type Customization } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import {
  T0,
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

let fake: FakeClaudeDir;
let state: string;
let web: string;
let app: App | undefined;
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
  await app?.stop();
  app = undefined;
  await removeDir(fake.home);
  await removeDir(join(state, '..'));
  await removeDir(join(web, '..'));
});

const base = (): string => `http://127.0.0.1:${port}`;
const auth = (): Record<string, string> => ({ authorization: `Bearer ${(app as App).context.auth.value}` });
const send = (
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = auth(),
): Promise<Response> =>
  fetch(`${base()}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const document = async (response: Response): Promise<Customization> =>
  ((await response.json()) as { customization: Customization }).customization;

async function seedSession(sessionId = 's1'): Promise<void> {
  await fake.writeRegistry(100, { sessionId, name: 'Sessão de teste', status: 'busy', statusUpdatedAt: T0 + 59_000 });
  await fake.writeTranscript(sessionId, jsonl(userLine('Faça algo', 58_000), assistantLine([text('ok')], 58_500)));
}

describe('customization endpoints', () => {
  test('start empty and answer the whole document after every change', async () => {
    await boot();
    expect(await document(await send('GET', '/api/customization'))).toEqual({
      version: 1,
      agents: {},
      rooms: {},
      accounts: {},
      order: [],
    });
    const patched = await send('PATCH', '/api/customization', { rooms: { '/p': { alias: 'Loja', pinned: true } } });
    expect(patched.status).toBe(200);
    expect((await document(patched)).rooms['/p']).toEqual({ alias: 'Loja', pinned: true });

    const replaced = await send('PUT', '/api/customization', {
      version: 1,
      agents: { a: { name: 'Ana' } },
      rooms: {},
      accounts: {},
      order: ['/p'],
    });
    expect(await document(replaced)).toMatchObject({ agents: { a: { name: 'Ana' } }, rooms: {}, order: ['/p'] });
    expect((await document(await send('GET', '/api/customization'))).agents.a?.name).toBe('Ana');
  });

  test('reset one item with null and everything with DELETE', async () => {
    await boot();
    await send('PATCH', '/api/customization', { agents: { a: { name: 'Ana' }, b: { name: 'Bia' } }, order: ['/p'] });
    const one = await document(await send('PATCH', '/api/customization', { agents: { a: null } }));
    expect(Object.keys(one.agents)).toEqual(['b']);
    const all = await document(await send('DELETE', '/api/customization'));
    expect(all).toMatchObject({ agents: {}, rooms: {}, order: [] });
    expect((await document(await send('GET', '/api/customization'))).agents).toEqual({});
  });

  test('keeps the document in customization.json with mode 0600', async () => {
    await boot();
    await send('PATCH', '/api/customization', { agents: { a: { name: 'Ana' } } });
    const path = join(state, 'customization.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1, agents: { a: { name: 'Ana' } } });
  });

  test('survives a restart', async () => {
    await boot();
    await send('PATCH', '/api/customization', { rooms: { '/p': { theme: { floor: 'wood' } } } });
    await app?.stop();
    app = undefined;
    await boot();
    expect((await document(await send('GET', '/api/customization'))).rooms['/p']?.theme).toEqual({ floor: 'wood' });
  });

  test('explains what is wrong with a 400', async () => {
    await boot();
    const cases: [string, unknown, unknown][] = [
      ['PATCH', { agents: { a: { name: 'x'.repeat(33) } } }, { error: 'invalid-name', field: 'agents.a.name' }],
      ['PATCH', { agents: { a: { name: 'a\u0007b' } } }, { error: 'invalid-name', field: 'agents.a.name' }],
      [
        'PATCH',
        { rooms: { '/p': { theme: { color: 'blue' } } } },
        { error: 'invalid-theme', field: 'rooms./p.theme.color' },
      ],
      [
        'PATCH',
        { agents: { a: { look: { accessory: 'hat' } } } },
        { error: 'invalid-look', field: 'agents.a.look.accessory' },
      ],
      ['PATCH', { order: [1] }, { error: 'invalid-order', field: 'order.0' }],
      ['PATCH', { nope: 1 }, { error: 'invalid-body', field: 'nope' }],
      ['PUT', { version: 3 }, { error: 'unsupported-version', field: 'version' }],
    ];
    for (const [method, body, expected] of cases) {
      const response = await send(method, '/api/customization', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.json()).toEqual(expected);
    }
    expect((await document(await send('GET', '/api/customization'))).agents).toEqual({});
  });

  test('refuses a body that is too big, empty or not JSON', async () => {
    await boot();
    const big = await fetch(`${base()}/api/customization`, {
      method: 'PATCH',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ agents: { a: { name: 'x'.repeat(250_000) } } }),
    });
    expect(big.status).toBe(413);
    const empty = await fetch(`${base()}/api/customization`, {
      method: 'PATCH',
      headers: { ...auth(), 'content-type': 'application/json' },
    });
    expect(empty.status).toBe(400);
    const broken = await fetch(`${base()}/api/customization`, {
      method: 'PUT',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: '{oops',
    });
    expect(broken.status).toBe(400);
  });

  test('needs the token, JSON and a same-origin request', async () => {
    await boot();
    expect((await send('GET', '/api/customization', undefined, {})).status).toBe(401);
    expect((await send('PATCH', '/api/customization', { order: [] }, {})).status).toBe(401);
    const text415 = await fetch(`${base()}/api/customization`, {
      method: 'PATCH',
      headers: { ...auth(), 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(text415.status).toBe(415);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const body = method === 'DELETE' ? undefined : { version: 1 };
      expect(
        (await send(method, '/api/customization', body, { ...auth(), origin: 'http://evil.example' })).status,
      ).toBe(403);
      expect(
        (await send(method, '/api/customization', body, { ...auth(), 'sec-fetch-site': 'cross-site' })).status,
      ).toBe(403);
    }
  });

  test('is local only', async () => {
    await boot({ AI_OFFICE_ALLOW_REMOTE: '1', AI_OFFICE_HOST: '0.0.0.0' });
    const remote = (method: string, body?: unknown): Promise<number> =>
      new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path: '/api/customization',
            method,
            headers: {
              host: `192.168.1.5:${port}`,
              ...auth(),
              ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end(payload);
      });
    for (const [method, body] of [['GET'], ['PUT', { version: 1 }], ['PATCH', { order: [] }], ['DELETE']] as const) {
      expect(await remote(method, body), method).toBe(403);
    }
  });
});

describe('customization in the snapshot', () => {
  test('renames an agent, resolves its look and decorates its room; a reset takes it all back', async () => {
    await seedSession();
    await boot();
    const snapshot = () => (app as App).context.snapshots.build();
    const before = snapshot();
    const agent = before.agents.find((candidate) => candidate.kind === 'main');
    expect(agent).toBeDefined();
    const projectId = agent?.projectId as string;
    const picked = agent?.name as string;

    await send('PATCH', '/api/customization', {
      agents: { [agent?.id as string]: { name: 'Capitã Ana', look: { hairColor: 'red' } } },
      rooms: {
        [projectId]: { alias: 'Casa', theme: { floor: 'tiles', sign: 'neon' }, look: { outfit: 'teal' }, pinned: true },
      },
      accounts: { [agent?.accountId as string]: { look: { accessory: 'cap' } } },
      order: [projectId],
    });
    const after = snapshot();
    const renamed = after.agents.find((candidate) => candidate.id === agent?.id);
    expect(renamed).toMatchObject({
      name: 'Capitã Ana',
      defaultName: picked,
      appearance: { hairColor: 'red', outfit: 'teal', accessory: 'cap' },
    });
    expect(after.projects.find((project) => project.id === projectId)).toMatchObject({
      name: 'Casa',
      originalName: before.projects[0]?.name,
      theme: { floor: 'tiles', sign: 'neon' },
      pinned: true,
      rank: 0,
    });

    await send('DELETE', '/api/customization');
    const reset = snapshot();
    expect(reset.agents.find((candidate) => candidate.id === agent?.id)).toMatchObject({ name: picked });
    expect(reset.agents.find((candidate) => candidate.id === agent?.id)?.defaultName).toBeUndefined();
    expect(reset.projects[0]?.name).toBe(before.projects[0]?.name);
  });

  test('a change reaches the stream without waiting for a session event', async () => {
    await seedSession();
    await boot();
    const published: string[] = [];
    const hub = (app as App).context.hub;
    const original = hub.broadcastSnapshot.bind(hub);
    hub.broadcastSnapshot = (snapshot) => {
      published.push(snapshot.projects[0]?.name ?? '');
      original(snapshot);
    };
    const projectId = (app as App).context.snapshots.build().projects[0]?.id as string;
    await send('PATCH', '/api/customization', { rooms: { [projectId]: { alias: 'Novo nome' } } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(published).toContain('Novo nome');
  });

  test('uses the chosen name in the feed and the notices of a real agent', async () => {
    await seedSession();
    await boot();
    const snapshot = (app as App).context.snapshots.build();
    const agent = snapshot.agents.find((candidate) => candidate.kind === 'main');
    await send('PATCH', '/api/customization', { agents: { [agent?.id as string]: { name: 'Capitã Ana' } } });
    const added = (app as App).context.office.addExternalActivity(agent?.id as string, messageDraft('oi'));
    expect(added).toBeDefined();
    expect((app as App).context.office.recentFeed().at(-1)?.agentName).toBe('Capitã Ana');
  });
});
