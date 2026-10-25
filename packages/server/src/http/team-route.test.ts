import { mkdir, writeFile } from 'node:fs/promises';
import { type IncomingHttpHeaders, request } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DEMO_PROJECTS, normalizePairingCode, type TeamStatus } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { silentLogger } from '../log';
import { freePort, makeFakeClaude, makeTempDir, removeDir, type FakeClaudeDir } from '../test-helpers';

interface Node {
  app: App;
  port: number;
  fake: FakeClaudeDir;
  dir: string;
}

const nodes: Node[] = [];

async function boot(env: NodeJS.ProcessEnv = {}): Promise<Node> {
  const fake = await makeFakeClaude();
  const dir = await makeTempDir('ai-office-team-http-');
  const web = join(dir, 'dist');
  await mkdir(web, { recursive: true });
  await writeFile(join(web, 'index.html'), '<!doctype html><title>AI Office</title>');
  const port = await freePort();
  const config = loadConfig(
    {
      HOME: fake.home,
      AI_OFFICE_PORT: String(port),
      AI_OFFICE_STATE_DIR: join(dir, 'state'),
      AI_OFFICE_WEB_DIR: web,
      AI_OFFICE_DEMO: '1',
      AI_OFFICE_TEAM_LOOPBACK: '1',
      ...env,
    },
    [],
    web,
  );
  const app = createApp(config, silentLogger, { pidAlive: () => true, version: '9.9.9' });
  await app.start();
  const node = { app, port, fake, dir };
  nodes.push(node);
  return node;
}

afterEach(async () => {
  for (const node of nodes.splice(0)) {
    await node.app.stop();
    await removeDir(node.fake.home);
    await removeDir(node.dir);
  }
});

const bearer = (node: Node): Record<string, string> => ({ authorization: `Bearer ${node.app.context.auth.value}` });

async function call(
  node: Node,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = bearer(node),
) {
  const response = await fetch(`http://127.0.0.1:${node.port}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

function raw(
  node: Node,
  path: string,
  method: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: node.port, path, method, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function until(check: () => boolean, label: string, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

describe('team management endpoints', () => {
  test('need the access token, like every other /api route', async () => {
    const node = await boot();

    for (const [method, path] of [
      ['GET', '/api/team'],
      ['POST', '/api/team/host/start'],
      ['POST', '/api/team/join'],
      ['POST', '/api/team/leave'],
      ['POST', '/api/team/sharing'],
    ] as const) {
      const response = await call(node, method, path, method === 'POST' ? {} : undefined, {});
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  test('refuse cross-site requests', async () => {
    const node = await boot();

    const response = await raw(node, '/api/team', 'GET', { ...bearer(node), 'sec-fetch-site': 'cross-site' });

    expect(response.status).toBe(403);
  });

  test('start off: nothing listens until the person asks', async () => {
    const node = await boot();

    const status = (await call(node, 'GET', '/api/team')).json as unknown as TeamStatus;

    expect(status).toMatchObject({ available: true, role: null });
    expect(status.sharing).toEqual({
      paused: false,
      projectNames: false,
      activityText: false,
      titles: false,
      branches: false,
      usage: false,
    });
    expect(node.app.context.team.snapshot()).toBeUndefined();
  });

  test('AI_OFFICE_TEAM=0 turns the mode off for good', async () => {
    const node = await boot({ AI_OFFICE_TEAM: '0' });

    expect(((await call(node, 'GET', '/api/team')).json as unknown as TeamStatus).available).toBe(false);
    const start = await call(node, 'POST', '/api/team/host/start', { address: '127.0.0.1', name: 'A' });
    expect(start).toMatchObject({ status: 409, json: { error: 'team-disabled' } });
  });

  test('refuse bad input with clear codes', async () => {
    const node = await boot();

    expect(await call(node, 'POST', '/api/team/host/start', { address: '8.8.8.8', name: 'A' })).toMatchObject({
      status: 400,
      json: { error: 'invalid-address' },
    });
    expect(await call(node, 'POST', '/api/team/join', { address: '127.0.0.1', code: 'x', name: 'A' })).toMatchObject({
      status: 400,
      json: { error: 'invalid-code' },
    });
    expect(await call(node, 'POST', '/api/team/sharing', { usage: 'yes' })).toMatchObject({ status: 200 });
    expect(await call(node, 'POST', '/api/team/leave', {})).toMatchObject({
      status: 409,
      json: { error: 'not-member' },
    });
  });
});

describe('two real servers in one team', () => {
  test('host, join with the code, share sanitized offices both ways, then revoke', async () => {
    const host = await boot();
    const member = await boot();
    const teamPort = await freePort();

    const started = await call(host, 'POST', '/api/team/host/start', {
      address: '127.0.0.1',
      port: teamPort,
      name: 'Helena',
      teamName: 'Time Azul',
    });
    const status = started.json as unknown as TeamStatus;
    expect(status.host).toMatchObject({ link: 'listening', address: '127.0.0.1', port: teamPort });
    const code = normalizePairingCode(status.host?.pairing?.code ?? '');
    const joined = await call(member, 'POST', '/api/team/join', {
      address: '127.0.0.1',
      port: teamPort,
      code,
      name: 'Bruno',
    });
    expect(joined.status).toBe(200);

    const hostView = (): ReturnType<App['context']['snapshots']['build']>['team'] =>
      host.app.context.snapshots.build().team;
    const memberView = (): ReturnType<App['context']['snapshots']['build']>['team'] =>
      member.app.context.snapshots.build().team;
    await until(() => (hostView()?.people.find((p) => !p.host)?.agents.length ?? 0) > 0, 'host sees the member agents');
    await until(
      () => (memberView()?.people.find((p) => p.host)?.agents.length ?? 0) > 0,
      'member sees the host agents',
    );

    const seen = JSON.stringify([hostView(), memberView()]);
    for (const project of DEMO_PROJECTS) {
      expect(seen).not.toContain(project.path);
      expect(seen).not.toContain(project.name);
    }
    expect(hostView()).toMatchObject({ role: 'host', link: 'listening', people: [{ name: 'Bruno', online: true }] });
    expect(memberView()).toMatchObject({
      role: 'member',
      link: 'connected',
      people: [{ name: 'Helena', host: true, online: true }],
    });
    expect(hostView()?.people[0]?.rooms.every((room) => room.name === undefined && room.index >= 1)).toBe(true);

    const id = ((await call(host, 'GET', '/api/team')).json as unknown as TeamStatus).host?.members[0]?.id;
    const revoked = await call(host, 'POST', '/api/team/host/revoke', { id });
    expect(revoked.status).toBe(200);
    await until(() => memberView()?.link === 'rejected', 'member rejected');
    expect(memberView()?.error).toBe('revoked');
  });

  test('the main listener stays on loopback and never answers on the team port, which speaks no HTTP', async () => {
    const host = await boot();
    const teamPort = await freePort();
    await call(host, 'POST', '/api/team/host/start', { address: '127.0.0.1', port: teamPort, name: 'Helena' });

    const mainAddress = host.app.server.address();
    const received: Buffer[] = [];
    const socket = connect(teamPort, '127.0.0.1');
    socket.on('data', (data: Buffer) => received.push(data));
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(
      `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:${teamPort}\r\nAuthorization: Bearer ${host.app.context.auth.value}\r\n\r\n`,
    );
    await new Promise((resolve) => socket.once('close', resolve));

    expect(typeof mainAddress === 'object' && mainAddress?.address).toBe('127.0.0.1');
    expect(Buffer.concat(received).length).toBe(0);
    expect(teamPort).not.toBe(host.port);
  });

  test('the main server refuses to bind a non-loopback address even with team mode on', () => {
    expect(() => loadConfig({ AI_OFFICE_HOST: '0.0.0.0', AI_OFFICE_TEAM_LOOPBACK: '1' }, [], '/tmp')).toThrow();
  });
});
