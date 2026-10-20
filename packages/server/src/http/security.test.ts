import { createHmac } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { type IncomingHttpHeaders, type IncomingMessage, request } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AUTH_COOKIE, HEALTH_PROOF_PREFIX } from '@ai-office/shared';
import { type App, type AppOptions, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import { T0, assistantLine, freePort, jsonl, makeFakeClaude, makeTempDir, removeDir, text, userLine, type FakeClaudeDir } from '../test-helpers';
import { MAX_CLIENTS } from './sse';
import { HEADERS_TIMEOUT_MS, REQUEST_TIMEOUT_MS, SECURITY_HEADERS } from './server';

let fake: FakeClaudeDir;
let state: string;
let web: string;
let app: App | undefined;
let port: number;
const opened: IncomingMessage[] = [];

async function boot(options: AppOptions = {}, extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  port = await freePort();
  const config = loadConfig({ HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...extraEnv }, [], web);
  app = createApp(config, silentLogger, { now: () => T0 + 60_000, pidAlive: () => true, version: '9.9.9', ...options });
  await app.start();
}

beforeEach(async () => {
  fake = await makeFakeClaude();
  state = join(await makeTempDir('ai-office-state-'), 'state');
  web = join(await makeTempDir('ai-office-web-'), 'dist');
  await mkdir(join(web, 'assets'), { recursive: true });
  await writeFile(join(web, 'index.html'), '<!doctype html><title>AI Office</title>');
  await writeFile(join(web, 'assets', 'app-Ab12Cd34.js'), 'console.log(1)');
});
afterEach(async () => {
  for (const res of opened.splice(0)) res.destroy();
  await app?.stop();
  app = undefined;
  await removeDir(fake.home);
  await removeDir(join(state, '..'));
  await removeDir(join(web, '..'));
});

const base = (): string => `http://127.0.0.1:${port}`;
const token = (): string => (app as App).context.auth.value;
const bearer = (value = token()): Record<string, string> => ({ authorization: `Bearer ${value}` });
const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

/** Raw request, so tests can send headers fetch refuses to send (Sec-Fetch-Site, Host) and read raw status/headers. */
function raw(path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function openStream(headers: Record<string, string> = bearer()): Promise<{ status: number; res: IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/stream', headers }, (res) => {
      opened.push(res);
      res.resume();
      resolve({ status: res.statusCode ?? 0, res });
    });
    req.on('error', reject);
    req.end();
  });
}

const until = async (check: () => boolean, ms = 3000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('access token', () => {
  test('is created with mode 0600 in a 0700 state dir, and reused on the next start', async () => {
    await boot();
    const path = join(state, 'token');
    const first = (await readFile(path, 'utf8')).trim();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(state)).mode & 0o777).toBe(0o700);
    expect(token()).toBe(first);
    await (app as App).stop();
    await boot();
    expect(token()).toBe(first);
  });

  test('a malformed token file is replaced by a fresh random token', async () => {
    await mkdir(state, { recursive: true });
    await writeFile(join(state, 'token'), 'short', { mode: 0o644 });
    await boot();
    expect(token()).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(join(state, 'token'), 'utf8')).trim()).toBe(token());
    expect((await stat(join(state, 'token'))).mode & 0o777).toBe(0o600);
  });

  test('every /api route except health refuses requests without a valid token', async () => {
    await boot();
    for (const path of ['/api/day', '/api/history?agent=x', '/api/sessions', '/api/demo', '/api/messages?agent=x', '/api/permissions/abc', '/api/transcript?session=s&account=claude', '/api/agents/hire/check?path=/', '/api/unknown']) {
      const response = await fetch(`${base()}${path}`);
      expect(response.status, path).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
    }
    for (const path of ['/api/demo', '/api/messages', '/api/messages/inbox', '/api/attention', '/api/permissions', '/api/agents/hire']) {
      expect((await post(path, {})).status, path).toBe(401);
    }
    expect((await fetch(`${base()}/api/stream`)).status).toBe(401);
    expect((app as App).context.hub.size).toBe(0);
  });

  test('rejects a wrong bearer token, a wrong cookie and a bearer without the scheme', async () => {
    await boot();
    const wrong = 'f'.repeat(64);
    expect((await fetch(`${base()}/api/day`, { headers: bearer(wrong) })).status).toBe(401);
    expect((await fetch(`${base()}/api/day`, { headers: { cookie: `${AUTH_COOKIE}=${wrong}` } })).status).toBe(401);
    expect((await fetch(`${base()}/api/day`, { headers: { authorization: token() } })).status).toBe(401);
    expect((await fetch(`${base()}/api/day`, { headers: { cookie: `${AUTH_COOKIE}=${token().slice(0, 10)}` } })).status).toBe(401);
    expect((await fetch(`${base()}/api/day?token=${token()}`)).status).toBe(401);
  });

  test('accepts the bearer header (hooks) and the cookie (page)', async () => {
    await boot();
    expect((await fetch(`${base()}/api/day`, { headers: bearer() })).status).toBe(200);
    expect((await fetch(`${base()}/api/day`, { headers: { authorization: `bearer ${token()}` } })).status).toBe(200);
    expect((await fetch(`${base()}/api/day`, { headers: { cookie: `a=b; ${AUTH_COOKIE}=${token()}; c=d` } })).status).toBe(200);
    expect((await post('/api/demo', { on: false }, { cookie: `${AUTH_COOKIE}=${token()}` })).status).toBe(200);
  });

  test('the page gets the cookie when it loads index.html (also via SPA routes), assets do not', async () => {
    await boot();
    const index = await fetch(`${base()}/`);
    const cookie = index.headers.get('set-cookie') ?? '';
    expect(cookie).toBe(`${AUTH_COOKIE}=${token()}; Path=/; HttpOnly; SameSite=Strict`);
    expect((await fetch(`${base()}/sala/1`)).headers.get('set-cookie')).toBe(cookie);
    expect((await fetch(`${base()}/`, { method: 'HEAD' })).headers.get('set-cookie')).toBe(cookie);
    expect((await fetch(`${base()}/assets/app-Ab12Cd34.js`)).headers.get('set-cookie')).toBeNull();
    // The cookie it was given is enough to talk to the API.
    const pair = cookie.split(';')[0] as string;
    expect((await fetch(`${base()}/api/day`, { headers: { cookie: pair } })).status).toBe(200);
  });

  test('health is public but minimal; the full report needs the token', async () => {
    await boot();
    const anonymous = await fetch(`${base()}/api/health`);
    expect(await anonymous.json()).toEqual({ ok: true });
    const authed = await (await fetch(`${base()}/api/health`, { headers: bearer() })).json();
    expect(authed).toMatchObject({ ok: true, version: '9.9.9', local: true, demo: false });
    expect(await (await fetch(`${base()}/api/health`, { headers: bearer('0'.repeat(64)) })).json()).toEqual({ ok: true });
  });

  test('health proves knowledge of the token for a valid challenge, and only then', async () => {
    await boot();
    const nonce = 'abc123_-XYZ';
    const body = (await (await fetch(`${base()}/api/health?challenge=${nonce}`)).json()) as { ok: boolean; proof?: string };
    expect(body.proof).toBe(createHmac('sha256', token()).update(HEALTH_PROOF_PREFIX + nonce).digest('hex'));
    expect(JSON.stringify(body)).not.toContain(token());
    for (const bad of ['', 'a b', 'x'.repeat(129), '<script>', 'a%00b']) {
      expect(await (await fetch(`${base()}/api/health?challenge=${encodeURIComponent(bad)}`)).json()).toEqual({ ok: true });
    }
  });
});

describe('Sec-Fetch-Site', () => {
  test('only same-origin and none (typed address) are accepted', async () => {
    await boot();
    for (const site of ['same-origin', 'none']) {
      expect((await raw('/api/day', { ...bearer(), 'sec-fetch-site': site })).status, site).toBe(200);
      expect((await raw('/', { 'sec-fetch-site': site })).status, site).toBe(200);
    }
    for (const site of ['cross-site', 'same-site', 'bogus']) {
      expect((await raw('/api/day', { ...bearer(), 'sec-fetch-site': site })).status, site).toBe(403);
      expect((await raw('/', { 'sec-fetch-site': site })).status, site).toBe(403);
      expect((await raw('/api/health', { 'sec-fetch-site': site })).status, site).toBe(403);
    }
    expect((await raw('/api/day', bearer())).status).toBe(200);
  });
});

describe('message inbox is consumed with POST', () => {
  test('GET /api/messages/inbox no longer exists and POST takes the queue', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', name: 'Sessão', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript('s1', jsonl(userLine('oi', 58_000), assistantLine([text('ok')], 58_500)));
    await boot();
    await (app as App).context.engine.scan();
    const sent = await post('/api/messages', { agents: ['claude:s1'], text: 'Faça isso' }, bearer());
    expect(sent.status).toBe(201);
    expect((await fetch(`${base()}/api/messages/inbox?session=s1&via=tool`, { headers: bearer() })).status).toBe(404);
    expect((app as App).context.messages.list('claude:s1')[0]?.status).toBe('queued');
    const taken = (await (await post('/api/messages/inbox', { session: 's1', via: 'tool' }, bearer())).json()) as { messages: { text: string }[] };
    expect(taken.messages.map((m) => m.text)).toEqual(['Faça isso']);
    expect(await (await post('/api/messages/inbox', { session: 's1', via: 'stop' }, bearer())).json()).toEqual({ messages: [] });
    expect(await (await post('/api/messages/inbox', { session: 'ghost' }, bearer())).json()).toEqual({ skip: 'unknown-session' });
    expect((await post('/api/messages/inbox', {}, bearer())).status).toBe(400);
  });
});

describe('response headers', () => {
  test('are set on static files, API answers, errors and the event stream', async () => {
    await boot();
    const responses = [
      await raw('/'),
      await raw('/assets/app-Ab12Cd34.js'),
      await raw('/missing.js'),
      await raw('/api/health'),
      await raw('/api/day', bearer()),
      await raw('/api/day'),
      await raw('/api/nope', bearer()),
      await raw('/', { host: 'evil.example:80' }),
    ];
    const stream = await openStream();
    for (const headers of [...responses.map((r) => r.headers), stream.res.headers]) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers[name.toLowerCase()], name).toBe(value);
    }
    expect(SECURITY_HEADERS['Content-Security-Policy']).toBe("default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
    expect(responses.map((r) => r.status)).toEqual([200, 200, 404, 200, 200, 401, 404, 403]);
  });
});

describe('event stream cap', () => {
  test(`answers 503 beyond ${MAX_CLIENTS} streams and accepts new ones when a slot frees up`, async () => {
    await boot();
    const streams = [];
    for (let i = 0; i < MAX_CLIENTS; i++) streams.push(await openStream());
    expect(streams.every((s) => s.status === 200)).toBe(true);
    await until(() => (app as App).context.hub.size === MAX_CLIENTS);
    const refused = await raw('/api/stream', bearer());
    expect(refused.status).toBe(503);
    expect(JSON.parse(refused.body)).toEqual({ error: 'too-many-streams' });
    streams[0]?.res.destroy();
    await until(() => (app as App).context.hub.size === MAX_CLIENTS - 1);
    const again = await openStream();
    expect(again.status).toBe(200);
  });
});

describe('timeouts', () => {
  test('default limits are 30 s for a whole request and 15 s for the headers', async () => {
    await boot();
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(HEADERS_TIMEOUT_MS).toBe(15_000);
    expect((app as App).server.requestTimeout).toBe(REQUEST_TIMEOUT_MS);
    expect((app as App).server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
  });

  test('a client that never finishes its headers is cut, but streams and long-polls outlive the request timeout', async () => {
    await fake.writeRegistry(100, { sessionId: 's1', name: 'Sessão', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript('s1', jsonl(userLine('oi', 58_000), assistantLine([text('ok')], 58_500)));
    await boot({ httpLimits: { requestTimeoutMs: 300, headersTimeoutMs: 200, checkIntervalMs: 40 } });
    await (app as App).context.engine.scan();

    const stream = await openStream();
    let streamClosed = false;
    stream.res.on('close', () => (streamClosed = true));
    const longPoll = fetch(`${base()}/api/messages/wait?session=s1&timeout=1`, { headers: bearer() }).then((r) => r.json());

    const slow = connect(port, '127.0.0.1');
    slow.write(`GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`);
    const closed = new Promise<string>((resolve) => {
      let received = '';
      slow.on('data', (chunk: Buffer) => (received += chunk.toString('latin1')));
      slow.on('close', () => resolve(received));
    });
    const reply = await closed;
    expect(reply === '' || reply.startsWith('HTTP/1.1 408')).toBe(true);

    expect(await longPoll).toEqual({ messages: [] });
    expect(streamClosed).toBe(false);
    expect((app as App).context.hub.size).toBe(1);
  });
});
