// Codex sessions through the HTTP API: snapshot, transcript, history of sessions, settings and the read-only rule.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  API,
  type CodexSettings,
  type HealthResponse,
  type OfficeSnapshot,
  type RecentSession,
  type TranscriptPage,
} from '@ai-office/shared';
import { type App, createApp } from '../app';
import {
  CWD,
  type FakeCodexHome,
  THREAD,
  assistantMessage,
  functionOutput,
  makeFakeCodex,
  sessionMeta,
  shellCall,
  taskStarted,
  tokenCount,
  turnContext,
  userMessage,
} from '../codex/fixtures';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import { T0, freePort, jsonl, makeTempDir, removeDir } from '../test-helpers';

let fake: FakeCodexHome;
let state: string;
let web: string;
let app: App;
let clock: number;

async function boot(env: Record<string, string> = {}): Promise<void> {
  const port = await freePort();
  const config = loadConfig(
    { HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...env },
    [],
    web,
  );
  app = createApp(config, silentLogger, { now: () => clock, pidAlive: () => true, version: '9.9.9' });
  await app.start();
}

beforeEach(async () => {
  clock = T0 + 60_000;
  fake = await makeFakeCodex();
  state = join(await makeTempDir('ai-office-state-'), 'state');
  web = join(await makeTempDir('ai-office-web-'), 'dist');
  await fake.write(
    THREAD,
    jsonl(
      sessionMeta(-50_000),
      turnContext(-49_000),
      taskStarted(-48_000),
      userMessage('Corrigir o login', -47_000),
      shellCall('c1', ['bash', '-lc', 'npm test'], 58_000),
      functionOutput('c1', 'all green', 58_500, 0),
      tokenCount({ input_tokens: 1000, output_tokens: 100 }, 58_800),
      assistantMessage('Pronto.', 59_000),
    ),
  );
});
afterEach(async () => {
  await app.stop();
  await removeDir(fake.home);
  await removeDir(join(state, '..'));
  await removeDir(join(web, '..'));
});

const base = (): string => `http://127.0.0.1:${app.port()}`;
const authed = (): Record<string, string> => ({ authorization: `Bearer ${app.context.auth.value}` });
const get = (path: string): Promise<Response> => fetch(`${base()}${path}`, { headers: authed() });
const post = (path: string, body: unknown): Promise<Response> =>
  fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { ...authed(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const snapshot = (): OfficeSnapshot => app.context.snapshots.build();

describe('the office', () => {
  test('a Codex session is an agent of the Codex account', async () => {
    await boot();
    const built = snapshot();
    expect(built.accounts).toMatchObject([{ id: 'codex', label: 'Codex', source: 'codex' }]);
    expect(built.agents).toMatchObject([
      { id: `codex:${THREAD}`, source: 'codex', accountId: 'codex', projectId: CWD },
    ]);
    const health = (await (await get(API.health)).json()) as HealthResponse;
    expect(health.accounts).toEqual([{ id: 'codex', dir: fake.dir, sessions: 1 }]);
  });

  test('usage cards cover the Codex account', async () => {
    await boot();
    await app.context.usage.refresh({ walk: true });
    expect(snapshot().usage.map((usage) => usage.accountId)).toContain('codex');
  });

  test('AI_OFFICE_CODEX=0 never reads Codex', async () => {
    await boot({ AI_OFFICE_CODEX: '0' });
    expect(snapshot().accounts).toEqual([]);
    expect(snapshot().agents).toEqual([]);
  });

  test('extra homes come from AI_OFFICE_CODEX_DIRS', async () => {
    const other = join(fake.home, 'second');
    await mkdir(other);
    await boot({ AI_OFFICE_CODEX_DIRS: `${other}, ~/nowhere` });
    expect(snapshot().accounts.map((account) => [account.id, account.dir])).toEqual([
      ['codex', fake.dir],
      ['codex-second', other],
    ]);
  });
});

describe('/api/transcript', () => {
  test('renders the rollout like a terminal view', async () => {
    await boot();
    const response = await get(`${API.transcript}?session=${THREAD}&account=codex`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as TranscriptPage;
    expect(page.title).toBe('Corrigir o login');
    expect(page.open).toBe(true);
    expect(page.entries.map((entry) => entry.kind)).toEqual(['user', 'tool', 'assistant']);
    expect(page.entries[1]).toMatchObject({
      kind: 'tool',
      name: 'Bash',
      result: 'all green',
      input: { command: 'npm test' },
    });
  });

  test('a session that is not being followed is found in its day folder', async () => {
    await boot();
    const other = '0199aaaa-bbbb-7ccc-8ddd-0000000000ee';
    await fake.write(other, jsonl(sessionMeta(0, { id: other }), userMessage('antigo', 10)), '2026/01/02');
    const response = await get(`${API.transcript}?session=${other}&account=codex`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as TranscriptPage).entries).toMatchObject([{ kind: 'user', text: 'antigo' }]);
  });

  test('unknown sessions and unsafe ids are refused', async () => {
    await boot();
    expect((await get(`${API.transcript}?session=nope&account=codex`)).status).toBe(404);
    expect((await get(`${API.transcript}?session=${THREAD}&account=codex&agent=nope`)).status).toBe(404);
    expect((await get(`${API.transcript}?session=../x&account=codex`)).status).toBe(400);
  });
});

describe('/api/sessions', () => {
  test('lists Codex sessions with their name and folder', async () => {
    await boot();
    const response = await get(API.sessions);
    const { sessions } = (await response.json()) as { sessions: RecentSession[] };
    expect(sessions).toMatchObject([
      { accountId: 'codex', sessionId: THREAD, projectPath: CWD, title: 'Corrigir o login', open: true },
    ]);
  });
});

describe('read-only', () => {
  test('a message to a Codex agent is refused', async () => {
    await boot();
    const response = await post(API.messages, { agents: [`codex:${THREAD}`], text: 'olá' });
    expect(response.status).toBe(409);
    expect(app.context.messages.list(`codex:${THREAD}`)).toEqual([]);
  });

  test('a team message skips the Codex agents', async () => {
    await boot();
    app.context.setDemo(true);
    const demoAgent = app.context.office.demoSimulator?.agents().find((agent) => agent.source !== 'codex');
    const response = await post(API.messages, { agents: [`codex:${THREAD}`, demoAgent?.id ?? ''], text: 'olá' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { messages: { agentId: string }[] };
    expect(body.messages.map((message) => message.agentId)).toEqual([demoAgent?.id]);
  });
});

describe('/api/codex/settings', () => {
  test('needs the access token and local access', async () => {
    await boot();
    expect((await fetch(`${base()}${API.codexSettings}`)).status).toBe(401);
  });

  test('reports the state and turns the sessions off and on', async () => {
    await boot();
    expect(await (await get(API.codexSettings)).json()).toEqual({ sessions: true, available: true, locked: false });
    const off = await post(API.codexSettings, { sessions: false });
    expect((await off.json()) as CodexSettings).toMatchObject({ sessions: false });
    expect(snapshot().accounts).toEqual([]);
    const on = await post(API.codexSettings, { sessions: true });
    expect((await on.json()) as CodexSettings).toMatchObject({ sessions: true });
    expect(snapshot().accounts).toHaveLength(1);
  });

  test('rejects anything but a boolean', async () => {
    await boot();
    expect((await post(API.codexSettings, { sessions: 'yes' })).status).toBe(400);
    expect((await post(API.codexSettings, {})).status).toBe(400);
  });

  test('is locked when the server was started with AI_OFFICE_CODEX=0', async () => {
    await boot({ AI_OFFICE_CODEX: '0' });
    expect(await (await get(API.codexSettings)).json()).toEqual({ sessions: false, available: true, locked: true });
    expect((await post(API.codexSettings, { sessions: true })).status).toBe(409);
  });

  test('says when there is no Codex home', async () => {
    await boot({ CODEX_HOME: join(fake.home, 'missing') });
    expect(await (await get(API.codexSettings)).json()).toMatchObject({ available: false });
  });
});
