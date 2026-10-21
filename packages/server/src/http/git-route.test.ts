import { mkdir } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type DayReport, type GitSettings, type OfficeSnapshot, localDateKey } from '@ai-office/shared';
import { type App, createApp } from '../app';
import { loadConfig } from '../config';
import { RunError, type Runner } from '../git/run';
import { silentLogger } from '../log';
import { type FakeClaudeDir, T0, assistantLine, freePort, jsonl, makeFakeClaude, makeTempDir, removeDir, text, toolResultLine, toolUse, userLine } from '../test-helpers';

const OID = '0123456789abcdef0123456789abcdef01234567';
const PR_JSON = JSON.stringify({ number: 9, title: 'T', state: 'OPEN', url: 'https://github.com/o/r/pull/9', statusCheckRollup: [] });

let fake: FakeClaudeDir;
let state: string;
let web: string;
let project: string;
let app: App;
let clock: number;
const ghCalls: string[] = [];
const gitCalls: string[] = [];
const gitFolders = new Set<string>();

const runGit: Runner = (_file, args, options) => {
  gitFolders.add(options.cwd);
  const sub = args.find((arg) => ['status', 'diff', 'log', 'stash'].includes(arg)) ?? '';
  gitCalls.push(sub);
  if (args.includes('config')) return Promise.resolve('me@example.com\n');
  if (args.includes('--all')) return Promise.resolve(`a1b2c3d\t${Math.floor((T0 + 30_000) / 1000)}\tfeat: from the day log\n`);
  return Promise.resolve(sub === 'status' ? `# branch.oid ${OID}\n# branch.head feat/x\n1 .M N... 1 1 1 a b f.ts\n` : '');
};
const runGh: Runner = (_file, _args, options) => {
  ghCalls.push(options.cwd);
  return Promise.resolve(PR_JSON);
};

async function boot(gh: Runner = runGh): Promise<void> {
  const port = await freePort();
  const config = loadConfig({ HOME: fake.home, AI_OFFICE_PORT: String(port), AI_OFFICE_STATE_DIR: state, AI_OFFICE_WEB_DIR: web }, [], web);
  app = createApp(config, silentLogger, { now: () => clock, pidAlive: () => true, version: '9.9.9', gitRunners: { git: runGit, gh } });
  await app.start();
}

beforeEach(async () => {
  clock = T0 + 60_000;
  ghCalls.length = 0;
  gitCalls.length = 0;
  gitFolders.clear();
  fake = await makeFakeClaude();
  state = join(await makeTempDir('ai-office-state-'), 'state');
  web = join(await makeTempDir('ai-office-web-'), 'dist');
  project = join(await makeTempDir('ai-office-project-'), 'proj');
  await mkdir(join(project, '.git'), { recursive: true });
  await fake.writeRegistry(100, { sessionId: 's1', cwd: project, status: 'busy', statusUpdatedAt: T0 + 59_000 });
  await fake.writeTranscript('s1', jsonl(userLine('Hi', 100, { cwd: project }), assistantLine([text('ok')], 200, { extra: { cwd: project } })), project);
});
afterEach(async () => {
  await app.stop();
  await removeDir(fake.home);
  await removeDir(join(state, '..'));
  await removeDir(join(web, '..'));
  await removeDir(join(project, '..'));
});

const base = (): string => `http://127.0.0.1:${app.port()}`;
const authed = (): Record<string, string> => ({ authorization: `Bearer ${app.context.auth.value}` });
const post = (body: unknown, headers: Record<string, string> = authed()): Promise<Response> =>
  fetch(`${base()}/api/git/settings`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** One pass of the app's own clock: tick the watcher and wait for its reads. */
async function settle(): Promise<void> {
  app.context.git.tick();
  await app.context.git.idle();
}

describe('git state in the snapshot', () => {
  test('a room whose folder has a .git carries its git state', async () => {
    // Arrange
    await boot();
    await app.context.engine.scan();
    // Act
    await settle();
    const snapshot: OfficeSnapshot = app.context.snapshots.build();
    // Assert
    const room = snapshot.projects.find((candidate) => candidate.path === project);
    expect(room?.git).toMatchObject({ branch: 'feat/x', unstaged: 1 });
    expect(room?.git?.pr).toBeUndefined();
    expect(snapshot.meta.gitPullRequests).toBeUndefined();
  });

  test('a finished tool call makes the watcher read the repository again soon', async () => {
    // Arrange
    await boot();
    await app.context.engine.scan();
    await settle();
    const reads = gitCalls.filter((call) => call === 'status').length;
    // Act: the agent runs a tool and the result arrives
    await fake.appendTranscript(
      's1',
      jsonl(assistantLine([toolUse('t1', 'Bash', { command: 'touch f' })], 300, { extra: { cwd: project } }), toolResultLine('t1', 'ok', 400, { cwd: project })),
      project,
    );
    await app.context.engine.scan();
    clock += 2500;
    await settle();
    // Assert
    expect(gitCalls.filter((call) => call === 'status').length).toBe(reads + 1);
  });

  test('the demo rooms bring their own fake state and are never read', async () => {
    // Arrange
    await boot();
    app.context.setDemo(true);
    await settle();
    // Act
    const snapshot = app.context.snapshots.build();
    // Assert
    const demoRooms = snapshot.projects.filter((candidate) => candidate.path.startsWith('/Users/demo/'));
    expect(demoRooms.length).toBeGreaterThan(0);
    expect(demoRooms.every((candidate) => candidate.git !== undefined)).toBe(true);
    expect([...gitFolders]).toEqual([project]);
  });
});

describe('the day report', () => {
  test('gets the commits of the day from the repository of each project', async () => {
    // Arrange
    await boot();
    await app.context.engine.scan();
    const date = localDateKey(clock);
    // Act
    const response = await fetch(`${base()}/api/report/day?date=${date}`, { headers: authed() });
    const report = (await response.json()) as DayReport;
    // Assert
    expect(response.status).toBe(200);
    const room = report.projects.find((candidate) => candidate.id === project);
    expect(room?.gitCommits).toEqual([{ hash: 'a1b2c3d', subject: 'feat: from the day log', at: Math.floor((T0 + 30_000) / 1000) * 1000, source: 'git' }]);
  });
});

describe('/api/git/settings', () => {
  test('needs the access token', async () => {
    await boot();
    const response = await fetch(`${base()}/api/git/settings`);
    expect(response.status).toBe(401);
  });

  test('starts with pull requests off', async () => {
    await boot();
    const response = await fetch(`${base()}/api/git/settings`, { headers: authed() });
    expect(response.status).toBe(200);
    expect((await response.json()) as GitSettings).toEqual({ pullRequests: false, gh: 'unknown' });
  });

  test('turning pull requests on is what makes gh run, and shows in the snapshot', async () => {
    // Arrange
    await boot();
    await app.context.engine.scan();
    await settle();
    expect(ghCalls).toEqual([]);
    // Act
    const response = await post({ pullRequests: true });
    await settle();
    clock += 1000;
    await settle();
    // Assert
    expect(response.status).toBe(200);
    expect(((await response.json()) as GitSettings).pullRequests).toBe(true);
    expect(ghCalls).toEqual([project]);
    const snapshot = app.context.snapshots.build();
    expect(snapshot.meta.gitPullRequests).toBe(true);
    expect(snapshot.projects.find((candidate) => candidate.path === project)?.git?.pr).toMatchObject({ number: 9 });
  });

  test('reports gh when it is not installed', async () => {
    // Arrange
    await boot(() => Promise.reject(new RunError('spawn gh ENOENT', 'ENOENT', '', false)));
    await app.context.engine.scan();
    await settle();
    // Act
    await post({ pullRequests: true });
    await settle();
    clock += 1000;
    await settle();
    // Assert
    const response = await fetch(`${base()}/api/git/settings`, { headers: authed() });
    expect(await response.json()).toEqual({ pullRequests: true, gh: 'missing' });
  });

  test.each([{}, { pullRequests: 'yes' }, { pullRequests: 1 }, []])('refuses the body %j', async (body) => {
    await boot();
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid-pullRequests' });
  });

  test('refuses requests that come from another site', async () => {
    await boot();
    const response = await post({ pullRequests: true }, { ...authed(), 'sec-fetch-site': 'cross-site' });
    expect(response.status).toBe(403);
    expect(app.context.gitSettings.pullRequests).toBe(false);
  });

  test('refuses a Host that is not local', async () => {
    await boot();
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port: app.port(), path: '/api/git/settings', headers: { ...authed(), host: 'evil.example:4848' } }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.once('error', reject);
      request.end();
    });
    expect(status).toBe(403);
  });
});
