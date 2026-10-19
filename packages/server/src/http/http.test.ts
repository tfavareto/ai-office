import { request } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { OfficeSnapshot } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import { type FakeClaudeDir, T0, assistantLine, freePort, jsonl, makeFakeClaude, makeTempDir, removeDir, text, toolUse, userLine } from '../test-helpers';

let fake: FakeClaudeDir;
let state: string;
let web: string;
let app: App;
let base: string;
let port: number;

async function boot(extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  port = await freePort();
  const config = loadConfig({ HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web, ...extraEnv }, [], web);
  app = createApp(config, silentLogger, { now: () => T0 + 60_000, pidAlive: () => true, version: '9.9.9' });
  await app.start();
  base = `http://127.0.0.1:${port}`;
}

beforeEach(async () => {
  fake = await makeFakeClaude();
  state = await makeTempDir('ai-office-state-');
  web = join(await makeTempDir('ai-office-web-'), 'dist');
});
afterEach(async () => {
  await app.stop();
  await removeDir(fake.home);
  await removeDir(state);
  await removeDir(join(web, '..'));
});

async function seedSession(sessionId = 's1', pid = 100): Promise<void> {
  await fake.writeRegistry(pid, { sessionId, name: 'Sessão de teste', status: 'busy', statusUpdatedAt: T0 + 59_000 });
  await fake.writeTranscript(
    sessionId,
    jsonl(userLine('Faça algo', 58_000), assistantLine([toolUse('tu1', 'Agent', { description: 'Explorar', subagent_type: 'Explore' })], 58_500)),
  );
  await fake.writeSubagent(sessionId, 'sub1', jsonl(userLine('ok', 58_600, { agentId: 'sub1' }), assistantLine([text('achei')], 58_700, { extra: { agentId: 'sub1' } })), { agentType: 'Explore', description: 'Explorar', toolUseId: 'tu1' });
}

/** fetch with the access token, like the page (cookie) or a hook (bearer) would send it. */
const apiFetch = (url: string, init: RequestInit = {}): Promise<Response> =>
  fetch(url, { ...init, headers: { authorization: `Bearer ${app.context.auth.value}`, ...(init.headers as Record<string, string> | undefined) } });

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const response = await apiFetch(`${base}${path}`);
  return { status: response.status, body: (await response.json()) as T };
};

/** Opens the SSE stream and resolves with the chunks received until `done` returns true. */
function openStream(done: (text: string) => boolean): Promise<{ text: string; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}/api/stream`, { headers: { authorization: `Bearer ${app.context.auth.value}` } }, (res) => {
      let received = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        received += chunk;
        if (done(received)) resolve({ text: received, close: () => req.destroy() });
      });
      res.on('error', () => undefined);
    });
    req.on('error', reject);
    req.end();
  });
}

const snapshotOf = (stream: string): OfficeSnapshot => {
  const frames = stream.split('\n\n').filter((frame) => frame.startsWith('event: snapshot'));
  return JSON.parse((frames[frames.length - 1] as string).split('\n')[1]?.slice(6) ?? '{}') as OfficeSnapshot;
};

describe('basic routes and static files', () => {
  test('health reports version, accounts and session counts', async () => {
    await seedSession();
    await boot();
    const { status, body } = await get<{ ok: boolean; version: string; local: boolean; demo: boolean; accounts: { id: string; sessions: number }[] }>('/api/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, version: '9.9.9', local: true, demo: false, accounts: [{ id: 'claude', sessions: 1 }] });
  });

  test('rejects unknown Hosts, wrong content types, foreign origins and oversized bodies', async () => {
    await boot();
    const evil = await new Promise<number>((resolve) => {
      request({ host: '127.0.0.1', port, path: '/api/health', headers: { host: 'evil.example:80' } }, (res) => resolve(res.statusCode ?? 0)).end();
    });
    expect(evil).toBe(403);
    expect((await apiFetch(`${base}/api/demo`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await apiFetch(`${base}/api/demo`, json({ on: true }, { origin: 'http://evil.example' }))).status).toBe(403);
    const big = await apiFetch(`${base}/api/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true, pad: 'x'.repeat(300_000) }) });
    expect(big.status).toBe(413);
    expect((await apiFetch(`${base}/api/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status).toBe(400);
    expect((await apiFetch(`${base}/api/nope`)).status).toBe(404);
  });

  test('serves a short note while the web app is not built', async () => {
    await boot();
    const response = await apiFetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('npm run build');
  });

  test('serves dist with MIME types, cache headers, SPA fallback and no path traversal', async () => {
    await mkdir(join(web, 'assets'), { recursive: true });
    await writeFile(join(web, 'index.html'), '<!doctype html><title>AI Office</title>');
    await writeFile(join(web, 'assets', 'app-Ab12Cd34.js'), 'console.log(1)');
    await writeFile(join(web, 'plain.css'), 'a{}');
    await boot();
    const index = await apiFetch(`${base}/`);
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(await index.text()).toContain('AI Office');
    const asset = await apiFetch(`${base}/assets/app-Ab12Cd34.js`);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await apiFetch(`${base}/plain.css`)).headers.get('content-type')).toContain('text/css');
    expect(await (await apiFetch(`${base}/sala/123`)).text()).toContain('AI Office');
    expect((await apiFetch(`${base}/missing.js`)).status).toBe(404);
    const traversal = await new Promise<number>((resolve) => {
      request({ host: '127.0.0.1', port, path: '/..%2f..%2fetc/passwd' }, (res) => resolve(res.statusCode ?? 0)).end();
    });
    expect([400, 404]).toContain(traversal);
    const head = await apiFetch(`${base}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    const snapshot = await openStream((t) => t.includes('event: feed'));
    expect(snapshotOf(snapshot.text).meta.build).toMatch(/^[0-9a-f]+$/);
    snapshot.close();
  });
});

describe('SSE stream', () => {
  test('sends retry, the initial snapshot with agents, and the feed backlog', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const stream = await openStream((t) => t.includes('event: feed'));
    stream.close();
    expect(stream.text.startsWith('retry: 2000')).toBe(true);
    const snapshot = snapshotOf(stream.text);
    expect(snapshot.meta).toMatchObject({ version: '9.9.9', local: true, demo: false });
    expect(snapshot.accounts.map((a) => a.id)).toEqual(['claude']);
    expect(snapshot.agents.map((a) => [a.kind, a.status])).toEqual([['main', 'working'], ['sub', 'working']]);
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.usage).toHaveLength(1);
  });

  test('counts local viewers and broadcasts later changes', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    expect(app.context.hub.localViewers()).toBe(0);
    const stream = await openStream((t) => t.includes('event: feed'));
    expect(app.context.hub.localViewers()).toBe(1);
    await fake.appendTranscript('s1', jsonl(assistantLine([toolUse('r', 'Read', { file_path: '/work/proj/x.ts' })], 59_900)));
    await app.context.engine.scan();
    app.context.office.refresh(T0 + 60_000);
    const more = await openStream((t) => t.includes('Lendo x.ts'));
    more.close();
    stream.close();
    expect(more.text).toContain('Lendo x.ts');
  });
});

describe('permissions', () => {
  const hookBody = { session_id: 's1', tool_name: 'Bash', tool_input: { command: 'npm install zod' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm install:*' }], behavior: 'allow', destination: 'localSettings' }] };

  test('skips when no page is open or the session is unknown', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    expect(await (await apiFetch(`${base}/api/permissions`, json(hookBody))).json()).toEqual({ skip: 'no-viewer' });
    const stream = await openStream((t) => t.includes('event: feed'));
    expect(await (await apiFetch(`${base}/api/permissions`, json({ ...hookBody, session_id: 'ghost' }))).json()).toEqual({ skip: 'unknown-session' });
    stream.close();
  });

  test('allow with a remembered rule flows from the hook to the page and back', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const stream = await openStream((t) => t.includes('event: feed'));
    const created = await apiFetch(`${base}/api/permissions`, json(hookBody));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(app.context.office.agentById('claude:s1')).toMatchObject({ status: 'waiting', permission: { id, summary: 'npm install zod', suggestions: ['Sempre permitir Bash(npm install:*) neste projeto'] } });
    expect(await get(`/api/permissions/${id}`)).toMatchObject({ status: 200, body: { id, toolName: 'Bash', input: { command: 'npm install zod' } } });
    expect((await get<{ status: string }>(`/api/permissions/${id}/wait?timeout=0`)).body).toEqual({ status: 'pending' });

    const waiting = get<{ status: string }>(`/api/permissions/${id}/wait?timeout=5`);
    const decision = await apiFetch(`${base}/api/permissions/${id}/decision`, json({ behavior: 'allow', suggestion: 0 }));
    expect(decision.status).toBe(200);
    expect((await waiting).body).toEqual({ status: 'decided', behavior: 'allow', suggestion: 0 });
    expect((await apiFetch(`${base}/api/permissions/${id}/decision`, json({ behavior: 'deny' }))).status).toBe(409);
    expect(app.context.office.agentById('claude:s1')?.status).not.toBe('waiting');
    stream.close();
  });

  test('validates decisions: behavior, suggestion index, unknown ids', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const stream = await openStream((t) => t.includes('event: feed'));
    const { id } = (await (await apiFetch(`${base}/api/permissions`, json(hookBody))).json()) as { id: string };
    expect((await apiFetch(`${base}/api/permissions/${id}/decision`, json({ behavior: 'maybe' }))).status).toBe(400);
    expect((await apiFetch(`${base}/api/permissions/${id}/decision`, json({ behavior: 'allow', suggestion: 5 }))).status).toBe(400);
    expect((await apiFetch(`${base}/api/permissions/${id}/decision`, json({ behavior: 'deny', suggestion: 0 }))).status).toBe(400);
    expect((await apiFetch(`${base}/api/permissions/zzz/decision`, json({ behavior: 'allow' }))).status).toBe(404);
    expect((await apiFetch(`${base}/api/permissions`, json({ tool_name: 'Bash' }))).status).toBe(400);
    expect((await apiFetch(`${base}/api/permissions/${id}/decision`, json({ behavior: 'deny', message: 'Não', interrupt: true }))).status).toBe(200);
    stream.close();
  });

  test('is cancelled when the session moves on (answered in the terminal)', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const stream = await openStream((t) => t.includes('event: feed'));
    const { id } = (await (await apiFetch(`${base}/api/permissions`, json(hookBody))).json()) as { id: string };
    await fake.appendTranscript('s1', jsonl(assistantLine([text('Seguindo em frente')], 62_000, { id: 'next-message' })));
    await app.context.engine.scan();
    expect((await get<{ status: string }>(`/api/permissions/${id}/wait?timeout=0`)).body).toEqual({ status: 'cancelled' });
    stream.close();
  });
});

describe('messages and attention', () => {
  test('page sends, hook receives via tool call, delivery shows up as an activity', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const sent = await apiFetch(`${base}/api/messages`, json({ agents: ['claude:s1'], text: 'Rode os testes antes de continuar.' }));
    expect(sent.status).toBe(201);
    const { messages } = (await sent.json()) as { messages: { id: string; status: string }[] };
    expect(messages).toHaveLength(1);
    expect((await get<{ messages: unknown[] }>('/api/messages?agent=claude:s1')).body.messages).toHaveLength(1);
    const take = async (): Promise<{ messages: { text: string }[] }> => (await (await apiFetch(`${base}/api/messages/inbox`, json({ session: 's1', via: 'tool' }))).json()) as { messages: { text: string }[] };
    expect((await take()).messages.map((m) => m.text)).toEqual(['Rode os testes antes de continuar.']);
    expect((await take()).messages).toEqual([]);
    const list = (await get<{ messages: { status: string; via: string }[] }>('/api/messages?agent=claude:s1')).body.messages;
    expect(list[0]).toMatchObject({ status: 'delivered', via: 'tool' });
    expect(app.context.office.recentFeed().some((item) => item.activity.kind === 'message')).toBe(true);
  });

  test('team messages share a group; unknown agents and bad bodies are rejected', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const both = await apiFetch(`${base}/api/messages`, json({ agents: ['claude:s1', 'claude:s1:sub1', 'ghost'], text: 'Time, atenção' }));
    const { messages } = (await both.json()) as { messages: { group?: string }[] };
    expect(messages).toHaveLength(2);
    expect(messages[0]?.group).toBe(messages[1]?.group);
    expect((await apiFetch(`${base}/api/messages`, json({ agents: ['ghost'], text: 'oi' }))).status).toBe(404);
    expect((await apiFetch(`${base}/api/messages`, json({ agents: [], text: 'oi' }))).status).toBe(400);
    expect((await apiFetch(`${base}/api/messages`, json({ agents: ['claude:s1'], text: '   ' }))).status).toBe(400);
  });

  test('the Stop hook long-poll wakes up with a new message, and skips without a page', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    expect((await get<{ skip: string }>('/api/messages/wait?session=s1&timeout=1')).body).toEqual({ skip: 'no-viewer' });
    expect((await get<{ skip: string }>('/api/messages/wait?session=ghost&timeout=1')).body).toEqual({ skip: 'unknown-session' });
    const stream = await openStream((t) => t.includes('event: feed'));
    const waiting = get<{ messages: { text: string }[] }>('/api/messages/wait?session=s1&timeout=10');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await apiFetch(`${base}/api/messages`, json({ agents: ['claude:s1'], text: 'Pode finalizar' }));
    expect((await waiting).body.messages.map((m) => m.text)).toEqual(['Pode finalizar']);
    expect((await get<{ messages: unknown[] }>('/api/messages/wait?session=s1&timeout=0.2')).body.messages).toEqual([]);
    stream.close();
  });

  test('the Notification hook marks the agent as waiting until its next transcript event', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const marked = await apiFetch(`${base}/api/attention`, json({ session_id: 's1', message: 'Claude needs your permission to use Bash' }));
    expect(await marked.json()).toEqual({ ok: true });
    expect(app.context.office.agentById('claude:s1')).toMatchObject({ status: 'waiting', waitingFor: 'Precisa de você' });
    expect(await (await apiFetch(`${base}/api/attention`, json({ session_id: 's1', message: 'Claude is waiting for your input' }))).json()).toEqual({ skip: 'idle-prompt' });
    expect(await (await apiFetch(`${base}/api/attention`, json({ session_id: 'ghost' }))).json()).toEqual({ skip: 'unknown-session' });
    await fake.appendTranscript('s1', jsonl(assistantLine([text('voltei')], 62_000, { id: 'x1' })));
    await app.context.engine.scan();
    expect(app.context.office.agentById('claude:s1')?.status).not.toBe('waiting');
  });
});

describe('transcript, sessions, history and day', () => {
  test('serves the transcript of a main session and of a subagent by its Agent.id', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const main = await get<{ entries: { kind: string }[]; next: number; open: boolean; title: string }>('/api/transcript?session=s1&account=claude');
    expect(main.status).toBe(200);
    expect(main.body.entries.map((e) => e.kind)).toEqual(['user', 'tool']);
    expect(main.body).toMatchObject({ open: true, title: 'Sessão de teste' });
    const sub = await get<{ entries: { kind: string }[] }>(`/api/transcript?session=s1&account=claude&agent=${encodeURIComponent('claude:s1:sub1')}`);
    expect(sub.body.entries.map((e) => e.kind)).toEqual(['user', 'assistant']);
    const raw = await get<{ entries: unknown[] }>('/api/transcript?session=s1&account=claude&agent=sub1');
    expect(raw.body.entries).toHaveLength(2);
    const later = await get<{ entries: unknown[] }>(`/api/transcript?session=s1&account=claude&after=${main.body.next}`);
    expect(later.body.entries.length).toBeLessThanOrEqual(1);
  });

  test('returns at most 500 entries per page and `next` walks through the rest', async () => {
    await fake.writeRegistry(100, { sessionId: 's9', name: 'Longa', status: 'busy', statusUpdatedAt: T0 + 59_000 });
    await fake.writeTranscript('s9', jsonl(...Array.from({ length: 1100 }, (_, i) => userLine(`p${i}`, i))));
    await boot();
    await app.context.engine.scan();
    type Page = { entries: { text: string }[]; next: number };
    const newest = (await get<Page>('/api/transcript?session=s9&account=claude')).body;
    expect(newest.entries).toHaveLength(500);
    expect(newest.entries[0]?.text).toBe('p600');
    expect(newest.next).toBe(1100);
    const first = (await get<Page>('/api/transcript?session=s9&account=claude&after=0')).body;
    expect(first.entries).toHaveLength(500);
    const second = (await get<Page>(`/api/transcript?session=s9&account=claude&after=${first.next}`)).body;
    expect(second.entries[0]?.text).toBe('p500');
    const third = (await get<Page>(`/api/transcript?session=s9&account=claude&after=${second.next}`)).body;
    expect(third.entries.map((e) => e.text)).toHaveLength(100);
    expect(third.next).toBe(1100);
  });

  test('validates transcript queries', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    expect((await get('/api/transcript?session=../x&account=claude')).status).toBe(400);
    expect((await get('/api/transcript?session=s1&account=nope')).status).toBe(404);
    expect((await get('/api/transcript?session=ghost&account=claude')).status).toBe(404);
    expect((await get('/api/transcript?session=s1&account=claude&after=-1')).status).toBe(400);
    expect((await get('/api/transcript?session=s1&account=claude&agent=../../x')).status).toBe(400);
  });

  test('lists recent sessions, activity history and the day', async () => {
    await seedSession();
    await boot();
    await app.context.engine.scan();
    const sessions = await get<{ sessions: { sessionId: string; open: boolean; agentId?: string }[] }>('/api/sessions');
    expect(sessions.body.sessions[0]).toMatchObject({ sessionId: 's1', open: true, agentId: 'claude:s1' });
    const history = await get<{ activities: { kind: string }[] }>('/api/history?agent=claude:s1');
    expect(history.body.activities.map((a) => a.kind)).toEqual(['prompt', 'subagent']);
    expect((await get('/api/history?agent=ghost')).status).toBe(404);
    expect((await get('/api/history')).status).toBe(400);
    const day = await get<{ date: string; agents: unknown[] }>('/api/day?date=2020-01-02');
    expect(day.body).toEqual({ date: '2020-01-02', agents: [] });
    expect((await get('/api/day?date=ontem')).status).toBe(400);
  });
});

describe('demo mode', () => {
  test('toggles fake agents that can be messaged and whose permissions can be answered', async () => {
    await boot();
    expect((await get<{ demo: boolean }>('/api/demo')).body).toEqual({ demo: false });
    expect(await (await apiFetch(`${base}/api/demo`, json({ on: true }))).json()).toEqual({ demo: true });
    expect((await get<{ demo: boolean }>('/api/health')).body.demo).toBe(true);
    const { office } = app.context;
    const demoAgents = office.state().agents.filter((a) => a.demo === true);
    expect(demoAgents.length).toBeGreaterThanOrEqual(6);
    expect(office.state().accounts.map((a) => a.id)).toContain('demo-pessoal');
    expect(office.state().projects.map((p) => p.order)).toEqual([...office.state().projects.map((p) => p.order)].sort((a, b) => a - b));

    const target = demoAgents.find((a) => a.kind === 'main') as (typeof demoAgents)[number];
    const sent = await apiFetch(`${base}/api/messages`, json({ agents: [target.id], text: 'Como está indo?' }));
    expect(sent.status).toBe(201);
    expect((await get<{ messages: unknown[] }>(`/api/messages?agent=${encodeURIComponent(target.id)}`)).body.messages).toHaveLength(1);

    for (let i = 0; i < 40 && office.state().agents.every((a) => a.permission === undefined); i++) {
      office.tickDemo(Date.now() + i * 1000);
      office.refresh(Date.now() + i * 1000);
    }
    const waiting = office.state().agents.find((a) => a.demo === true && a.permission !== undefined);
    if (waiting?.permission !== undefined) {
      expect((await apiFetch(`${base}/api/permissions/${waiting.permission.id}/decision`, json({ behavior: 'allow' }))).status).toBe(200);
    }
    expect(await (await apiFetch(`${base}/api/demo`, json({ on: false }))).json()).toEqual({ demo: false });
    expect(office.state().agents.filter((a) => a.demo === true)).toHaveLength(0);
  });

  test('starts in demo mode with AI_OFFICE_DEMO=1', async () => {
    await boot({ AI_OFFICE_DEMO: '1' });
    expect((await get<{ demo: boolean }>('/api/health')).body.demo).toBe(true);
  });
});
