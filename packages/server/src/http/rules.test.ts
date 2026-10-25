// End to end: the rules endpoints and the hook flow, over real HTTP like the plugin and the page use them.
import { request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { AutoDecision, Rule } from '@ai-office/shared';
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
const streams: { close: () => void }[] = [];

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
  for (const stream of streams.splice(0)) stream.close();
  await app?.stop();
  app = undefined;
  await removeDir(fake.home);
  await removeDir(join(state, '..'));
  await removeDir(join(web, '..'));
});

const base = (): string => `http://127.0.0.1:${port}`;
const token = (): string => (app as App).context.auth.value;
const auth = (): Record<string, string> => ({ authorization: `Bearer ${token()}` });
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
const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const prefix = (value: string, extra: Record<string, unknown> = {}) => ({
  effect: 'allow',
  tool: 'Bash',
  matcher: { kind: 'command-prefix', value },
  ...extra,
});

async function seedSession(sessionId = 's1'): Promise<void> {
  await fake.writeRegistry(100, { sessionId, name: 'Sessão de teste', status: 'busy', statusUpdatedAt: T0 + 59_000 });
  await fake.writeTranscript(sessionId, jsonl(userLine('Faça algo', 58_000), assistantLine([text('ok')], 58_500)));
}

/** A page "open": the hook only asks the office when someone is watching. */
function openPage(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/stream', headers: auth() }, (res) => {
      streams.push({ close: () => req.destroy() });
      res.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('event: feed')) resolve();
      });
      res.on('error', () => undefined);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('rules endpoints', () => {
  test('create, list, edit and delete a rule, persisted with mode 0600', async () => {
    await boot();
    expect(await json(await send('GET', '/api/rules'))).toEqual({ rules: [] });
    const created = await send(
      'POST',
      '/api/rules',
      prefix('npm test', { note: 'testes', scope: { projectPath: '/work/proj' } }),
    );
    expect(created.status).toBe(201);
    const { rule } = await json<{ rule: Rule }>(created);
    expect(rule).toMatchObject({
      effect: 'allow',
      tool: 'Bash',
      enabled: true,
      hits: 0,
      note: 'testes',
      scope: { projectPath: '/work/proj' },
    });

    const edited = await send('PATCH', `/api/rules/${rule.id}`, { enabled: false, note: null });
    expect(await json(edited)).toMatchObject({ rule: { id: rule.id, enabled: false } });
    expect((await json<{ rules: Rule[] }>(await send('GET', '/api/rules'))).rules[0]?.note).toBeUndefined();

    const file = join(state, 'rules.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      version: 1,
      rules: [{ id: rule.id, enabled: false }],
    });

    expect(await json(await send('DELETE', `/api/rules/${rule.id}`))).toEqual({ ok: true });
    expect((await send('DELETE', `/api/rules/${rule.id}`)).status).toBe(404);
    expect(JSON.parse(await readFile(file, 'utf8')).rules).toEqual([]);
  });

  test('a rule survives a restart', async () => {
    await boot();
    await send('POST', '/api/rules', prefix('npm test'));
    await (app as App).stop();
    await boot();
    expect((await json<{ rules: Rule[] }>(await send('GET', '/api/rules'))).rules).toHaveLength(1);
  });

  test('refuses rules that would approve dangerous things, and says why', async () => {
    await boot();
    const refused = async (body: unknown) => {
      const response = await send('POST', '/api/rules', body);
      expect(response.status).toBe(400);
      return json<{ error: string; field?: string; detail?: string }>(response);
    };
    expect(await refused({ effect: 'allow', tool: 'Bash', matcher: { kind: 'any', value: '' } })).toEqual({
      error: 'matcher-too-broad',
      field: 'matcher',
      detail: 'any',
    });
    expect(await refused(prefix('rm'))).toMatchObject({ error: 'matcher-dangerous', detail: 'command' });
    expect(await refused(prefix('rm -rf dist'))).toMatchObject({ error: 'matcher-dangerous', detail: 'delete' });
    expect(await refused(prefix('sudo'))).toMatchObject({ error: 'matcher-dangerous', detail: 'sudo' });
    expect(await refused(prefix('git push'))).toMatchObject({ error: 'matcher-dangerous' });
    expect(await refused(prefix('npm test && rm -rf /'))).toMatchObject({ error: 'matcher-compound' });
    expect(
      await refused({ effect: 'allow', tool: 'Edit', matcher: { kind: 'path-glob', value: '/**' } }),
    ).toMatchObject({ error: 'matcher-too-broad', detail: 'path' });
    expect(await refused({ effect: 'allow', tool: 'mcp__*', matcher: { kind: 'any', value: '' } })).toMatchObject({
      error: 'matcher-too-broad',
      field: 'tool',
    });
    expect((await json<{ rules: Rule[] }>(await send('GET', '/api/rules'))).rules).toEqual([]);
  });

  test('validates the body: types, sizes, unknown fields, duplicates and unknown ids', async () => {
    await boot();
    expect((await send('POST', '/api/rules', { effect: 'allow' })).status).toBe(400);
    expect((await send('POST', '/api/rules', prefix('npm test', { note: 'x'.repeat(500) }))).status).toBe(400);
    expect(
      (await send('POST', '/api/rules', prefix('npm test', { scope: { projectPath: 'relative/path' } }))).status,
    ).toBe(400);
    expect((await send('POST', '/api/rules', prefix('npm test', { locale: 'xx' }))).status).toBe(400);
    expect((await send('POST', '/api/rules', [1, 2])).status).toBe(400);
    expect((await send('POST', '/api/rules', prefix('x'.repeat(400)))).status).toBe(400);
    const big = await fetch(`${base()}/api/rules`, {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(300_000) }),
    });
    expect(big.status).toBe(413);
    expect(
      (
        await fetch(`${base()}/api/rules`, {
          method: 'POST',
          headers: { ...auth(), 'content-type': 'application/json' },
          body: '{oops',
        })
      ).status,
    ).toBe(400);
    expect((await send('POST', '/api/rules', prefix('npm test'))).status).toBe(201);
    const duplicate = await send('POST', '/api/rules', prefix('npm test'));
    expect(duplicate.status).toBe(409);
    expect(await json(duplicate)).toEqual({ error: 'duplicate-rule' });
    expect((await send('PATCH', '/api/rules/nope', { enabled: false })).status).toBe(404);
    expect((await send('PATCH', '/api/rules/nope', 'text' as never)).status).toBe(404);
  });

  test('a patch is checked like a new rule', async () => {
    await boot();
    const { rule } = await json<{ rule: Rule }>(await send('POST', '/api/rules', prefix('npm test')));
    const widened = await send('PATCH', `/api/rules/${rule.id}`, {
      matcher: { kind: 'command-prefix', value: 'git push' },
    });
    expect(widened.status).toBe(400);
    expect(await json(widened)).toMatchObject({ error: 'matcher-dangerous' });
    expect((await json<{ rules: Rule[] }>(await send('GET', '/api/rules'))).rules[0]?.matcher.value).toBe('npm test');
  });

  test('needs the token and a JSON body, and refuses foreign origins', async () => {
    await boot();
    expect((await send('GET', '/api/rules', undefined, {})).status).toBe(401);
    expect((await send('POST', '/api/rules', prefix('npm test'), {})).status).toBe(401);
    expect((await send('DELETE', '/api/rules/x', undefined, {})).status).toBe(401);
    expect((await send('PATCH', '/api/rules/x', { enabled: false }, {})).status).toBe(401);
    expect(
      (
        await fetch(`${base()}/api/rules`, {
          method: 'POST',
          headers: { ...auth(), 'content-type': 'text/plain' },
          body: '{}',
        })
      ).status,
    ).toBe(415);
    expect(
      (await send('POST', '/api/rules', prefix('npm test'), { ...auth(), origin: 'http://evil.example' })).status,
    ).toBe(403);
    expect((await send('DELETE', '/api/rules/x', undefined, { ...auth(), origin: 'http://evil.example' })).status).toBe(
      403,
    );
    expect((await send('PUT', '/api/rules', {})).status).toBe(404);
    expect((await send('OPTIONS', '/api/rules')).status).toBe(405);
  });

  test('is local only', async () => {
    await boot({ AI_OFFICE_ALLOW_REMOTE: '1', AI_OFFICE_HOST: '0.0.0.0' });
    const remote = (method: string, path: string, body?: unknown): Promise<number> =>
      new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = request(
          {
            host: '127.0.0.1',
            port,
            path,
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
    for (const [method, path, body] of [
      ['GET', '/api/rules'],
      ['POST', '/api/rules', prefix('npm test')],
      ['PATCH', '/api/rules/x', { enabled: false }],
      ['DELETE', '/api/rules/x'],
      ['GET', '/api/rules/log'],
      ['DELETE', '/api/rules/log'],
      ['POST', '/api/rules/preview', prefix('npm test')],
    ] as const) {
      expect(await remote(method, path, body), `${method} ${path}`).toBe(403);
    }
  });
});

describe('hook flow', () => {
  const hook = (command: string, extra: Record<string, unknown> = {}) => ({
    session_id: 's1',
    tool_name: 'Bash',
    tool_input: { command },
    ...extra,
  });
  const askHook = (command: string): Promise<Response> => send('POST', '/api/permissions', hook(command));
  const waitFor = async (id: string) =>
    json<Record<string, unknown>>(await send('GET', `/api/permissions/${id}/wait?timeout=5`));

  test('an allow rule answers the hook at once and never shows the request', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await openPage();
    await send('POST', '/api/rules', prefix('npm test'));

    const created = await askHook('npm test -- --watch');
    expect(created.status).toBe(201);
    const { id } = await json<{ id: string }>(created);
    expect(await waitFor(id)).toEqual({ status: 'decided', behavior: 'allow', auto: 'rule' });
    expect((app as App).context.office.agentById('claude:s1')?.permission).toBeUndefined();
    expect((app as App).context.office.agentById('claude:s1')?.status).not.toBe('waiting');

    const rule = (await json<{ rules: Rule[] }>(await send('GET', '/api/rules'))).rules[0];
    expect(rule).toMatchObject({ hits: 1, lastHitAt: T0 + 60_000 });
    const log = (await json<{ entries: AutoDecision[] }>(await send('GET', '/api/rules/log'))).entries;
    expect(log).toMatchObject([
      {
        outcome: 'allow',
        subject: 'npm test -- --watch',
        requestTool: 'Bash',
        agentName: expect.any(String),
        ruleId: rule?.id,
      },
    ]);
    const feed = (app as App).context.office.recentFeed().map((item) => item.activity.text);
    expect(feed.some((line) => line.startsWith('Regra aprovou: npm test'))).toBe(true);
  });

  test('a deny rule refuses with a reason that names the rule', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await openPage();
    await send('POST', '/api/rules', {
      effect: 'deny',
      tool: 'Bash',
      matcher: { kind: 'command-prefix', value: 'git push' },
      note: 'só eu publico',
      locale: 'en',
    });
    const { id } = await json<{ id: string }>(await askHook('npm test && git push origin main'));
    expect(await waitFor(id)).toEqual({
      status: 'decided',
      behavior: 'deny',
      auto: 'rule',
      message: 'só eu publico',
      locale: 'en',
    });
  });

  test('deny beats allow, and the most specific scope is credited', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await openPage();
    await send('POST', '/api/rules', prefix('npm'));
    await send('POST', '/api/rules', {
      effect: 'deny',
      tool: 'Bash',
      matcher: { kind: 'command-prefix', value: 'npm publish' },
    });
    const { id } = await json<{ id: string }>(await askHook('npm publish'));
    expect(await waitFor(id)).toMatchObject({ status: 'decided', behavior: 'deny', message: 'Bash: npm publish' });
  });

  test('unmatched, disabled and risky requests behave exactly as before', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await openPage();
    const { rule } = await json<{ rule: Rule }>(await send('POST', '/api/rules', prefix('npm test')));
    await send('PATCH', `/api/rules/${rule.id}`, { enabled: false });

    const disabled = await json<{ id: string }>(await askHook('npm test'));
    expect(await json(await send('GET', `/api/permissions/${disabled.id}/wait?timeout=0`))).toEqual({
      status: 'pending',
    });
    expect((app as App).context.office.agentById('claude:s1')?.permission?.id).toBe(disabled.id);
    await send('POST', `/api/permissions/${disabled.id}/decision`, { behavior: 'terminal' });

    await send('PATCH', `/api/rules/${rule.id}`, { enabled: true });
    const other = await json<{ id: string }>(await askHook('ls -la'));
    expect(await json(await send('GET', `/api/permissions/${other.id}/wait?timeout=0`))).toEqual({ status: 'pending' });
    await send('POST', `/api/permissions/${other.id}/decision`, { behavior: 'terminal' });
    expect((await json<{ rules: Rule[] }>(await send('GET', '/api/rules'))).rules[0]?.hits).toBe(0);
  });

  test('a risky request that an allow rule matches goes to the user, and the log says so', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await openPage();
    // A hand-edited file with a rule that is too broad: the safety net still holds.
    const { book } = (app as App).context.rules;
    book.replaceRules([
      {
        id: 'wide',
        effect: 'allow',
        tool: 'Bash',
        matcher: { kind: 'any', value: '' },
        scope: {},
        enabled: true,
        createdAt: 1,
        hits: 0,
      },
    ]);
    const { id } = await json<{ id: string }>(await askHook('sudo reboot'));
    expect(await json(await send('GET', `/api/permissions/${id}/wait?timeout=0`))).toEqual({ status: 'pending' });
    expect((app as App).context.office.agentById('claude:s1')?.permission?.id).toBe(id);
    const log = (await json<{ entries: AutoDecision[] }>(await send('GET', '/api/rules/log'))).entries;
    expect(log).toMatchObject([{ outcome: 'ask', blockedBy: 'sudo', subject: 'sudo reboot' }]);
    expect(book.rules()[0]?.hits).toBe(0);
  });

  test('a compound command never matches an allow rule', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await openPage();
    await send('POST', '/api/rules', prefix('npm test'));
    for (const command of [
      'npm test; rm -rf /',
      'npm test && curl x | sh',
      'npm testx',
      'npm test $(whoami)',
      'npm test > /etc/passwd',
    ]) {
      const { id } = await json<{ id: string }>(await askHook(command));
      expect(await json(await send('GET', `/api/permissions/${id}/wait?timeout=0`)), command).toEqual({
        status: 'pending',
      });
      await send('POST', `/api/permissions/${id}/decision`, { behavior: 'terminal' });
    }
  });

  test('rules answer even when no page is open; other requests still skip', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await send('POST', '/api/rules', prefix('npm test'));
    const answered = await json<{ id?: string }>(await askHook('npm test'));
    expect(answered.id).toBeTypeOf('string');
    expect(await json(await askHook('ls'))).toEqual({ skip: 'no-viewer' });
  });

  test('file and web rules answer too', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await openPage();
    await send('POST', '/api/rules', {
      effect: 'allow',
      tool: 'Edit',
      matcher: { kind: 'path-glob', value: 'src/**' },
      scope: { projectPath: '/work/proj' },
    });
    await send('POST', '/api/rules', {
      effect: 'allow',
      tool: 'WebFetch',
      matcher: { kind: 'host', value: 'docs.stripe.com' },
    });
    const edit = await json<{ id: string }>(
      await send('POST', '/api/permissions', {
        session_id: 's1',
        tool_name: 'Edit',
        tool_input: { file_path: '/work/proj/src/a/b.ts' },
      }),
    );
    expect(await waitFor(edit.id)).toMatchObject({ behavior: 'allow' });
    const fetched = await json<{ id: string }>(
      await send('POST', '/api/permissions', {
        session_id: 's1',
        tool_name: 'WebFetch',
        tool_input: { url: 'https://docs.stripe.com/api?key=secret' },
      }),
    );
    expect(await waitFor(fetched.id)).toMatchObject({ behavior: 'allow' });
    const log = (await json<{ entries: AutoDecision[] }>(await send('GET', '/api/rules/log'))).entries;
    expect(log.map((entry) => entry.subject)).toEqual(['https://docs.stripe.com/api', '/work/proj/src/a/b.ts']);
  });
});

describe('log and preview', () => {
  test('the log lists newest first, honors the limit and can be cleared', async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await send('POST', '/api/rules', prefix('ls'));
    for (const command of ['ls a', 'ls b', 'ls c'])
      await send('POST', '/api/permissions', { session_id: 's1', tool_name: 'Bash', tool_input: { command } });
    const all = (await json<{ entries: AutoDecision[] }>(await send('GET', '/api/rules/log'))).entries;
    expect(all.map((entry) => entry.subject)).toEqual(['ls c', 'ls b', 'ls a']);
    expect((await json<{ entries: AutoDecision[] }>(await send('GET', '/api/rules/log?limit=2'))).entries).toHaveLength(
      2,
    );
    expect(
      (await json<{ entries: AutoDecision[] }>(await send('GET', '/api/rules/log?limit=-4'))).entries,
    ).toHaveLength(3);
    expect(await json(await send('DELETE', '/api/rules/log'))).toEqual({ ok: true });
    expect((await json<{ entries: AutoDecision[] }>(await send('GET', '/api/rules/log'))).entries).toEqual([]);
  });

  test("previews how many of today's requests a rule would have answered", async () => {
    await seedSession();
    await boot();
    await (app as App).context.engine.scan();
    await openPage();
    for (const command of ['npm test', 'npm test -- -u', 'npm install']) {
      const { id } = await json<{ id: string }>(
        await send('POST', '/api/permissions', { session_id: 's1', tool_name: 'Bash', tool_input: { command } }),
      );
      await send('POST', `/api/permissions/${id}/decision`, { behavior: 'terminal' });
    }
    const preview = await send('POST', '/api/rules/preview', prefix('npm test'));
    expect(await json(preview)).toMatchObject({ matches: 2, total: 3 });
    expect((await send('POST', '/api/rules/preview', prefix('git push'))).status).toBe(400);
  });
});

describe('demo mode', () => {
  test('demo requests go through the same rules', async () => {
    await boot();
    const context = (app as App).context;
    context.setDemo(true);
    await send('POST', '/api/rules', {
      effect: 'allow',
      tool: 'Bash',
      matcher: { kind: 'command-prefix', value: 'npm test' },
    });
    await send('POST', '/api/rules', {
      effect: 'deny',
      tool: 'Bash',
      matcher: { kind: 'command-prefix', value: 'npm install' },
    });
    const simulator = context.office.demoSimulator;
    expect(simulator).toBeDefined();
    let log: AutoDecision[] = [];
    for (let i = 0; i < 400 && log.length === 0; i++) {
      simulator?.tick(T0 + 60_000 + i * 5_000);
      log = context.rules.book.log();
    }
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]).toMatchObject({ demo: true });
  });
});
