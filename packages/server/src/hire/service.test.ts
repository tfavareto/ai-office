import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, realpath, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type Account, type DemoSimulator, HIRE_WINDOW_MS, createDemoSimulator } from '@ai-office/shared';
import { HttpError } from '../http/respond';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { RateLimiter } from '../util/rate-limit';
import { HireRegistry } from './registry';
import { HireService, LAUNCHER_FILE } from './service';
import { LaunchError, type TerminalLauncher } from './terminals';

const T0 = 1_800_000_000_000;
const CLAUDE = '/home/ana/.local/bin/claude';

const DEFAULT_ACCOUNT: Account = { id: 'claude', label: 'Pessoal', initial: 'P', color: '#fff', dir: '/home/ana/.claude', isDefault: true };
const WORK_ACCOUNT: Account = { id: 'claude-work', label: 'work', initial: 'W', color: '#0f0', dir: '/home/ana/.claude-work' };

interface Opened {
  scriptPath: string;
  script: string;
}

let root: string;
let project: string;

beforeEach(async () => {
  root = await makeTempDir('ai-office-hire-service-');
  project = join(root, 'my app');
  await mkdir(project);
});
afterEach(async () => removeDir(root));

interface Harness {
  service: HireService;
  registry: HireRegistry;
  opened: Opened[];
  setClock: (value: number) => void;
}

function harness(
  options: {
    accounts?: Account[];
    rooms?: string[];
    demo?: DemoSimulator;
    claude?: string | undefined;
    launcher?: TerminalLauncher;
    limit?: number;
  } = {},
): Harness {
  let clock = T0;
  const opened: Opened[] = [];
  const registry = new HireRegistry({ now: () => clock, newId: () => 'hire-1', onChange: () => undefined, onExpired: () => undefined });
  const launcher: TerminalLauncher = options.launcher ?? {
    open: async (scriptPath) => {
      opened.push({ scriptPath, script: await readFile(scriptPath, 'utf8') });
      return 'Terminal';
    },
  };
  const service = new HireService({
    now: () => clock,
    log: silentLogger,
    homeDir: '/home/ana',
    tmpDir: root,
    accounts: () => options.accounts ?? [DEFAULT_ACCOUNT, WORK_ACCOUNT],
    realProjectIds: () => options.rooms ?? [],
    demo: () => options.demo,
    registry,
    launcher,
    resolveClaude: () => ('claude' in options ? options.claude : CLAUDE),
    launchLimiter: new RateLimiter(options.limit ?? 5, 60_000, () => clock),
    refresh: () => undefined,
  });
  return { service, registry, opened, setClock: (value) => void (clock = value) };
}

const code = async (promise: Promise<unknown>): Promise<{ status: number; error: string }> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, error: error.message };
    throw error;
  }
  throw new Error('expected the call to fail');
};

describe('HireService.hire (real sessions)', () => {
  test('opens a terminal for the folder and registers the placeholder', async () => {
    const { service, registry, opened } = harness();

    const hire = await service.hire({ projectPath: project, deskIndex: 4 });

    expect(opened).toHaveLength(1);
    expect(opened[0]?.script).toContain(`cd -- '${project}'`);
    expect(opened[0]?.script).toContain(`'${CLAUDE}'`);
    expect(opened[0]?.script).toContain('unset CLAUDE_CONFIG_DIR');
    expect(dirname(opened[0]?.scriptPath ?? '')).toContain('ai-office-hire-');
    expect(hire).toMatchObject({ id: 'hire-1', accountId: 'claude', deskIndex: 4, createdAt: T0 });
    expect(registry.list(T0)).toEqual([hire]);
  });

  test('puts the launcher in a private directory with a private file', async () => {
    const { service, opened } = harness();

    await service.hire({ projectPath: project, prompt: 'secret plan' });

    const scriptPath = opened[0]?.scriptPath ?? '';
    expect(statSync(scriptPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(scriptPath)).mode & 0o777).toBe(0o700);
    expect(scriptPath.endsWith(LAUNCHER_FILE)).toBe(true);
  });

  test('passes the model, the permission mode, the prompt, the account directory and the language', async () => {
    const { service, opened } = harness();

    await service.hire({ projectPath: project, accountId: 'claude-work', model: 'opus', permissionMode: 'plan', prompt: 'Fix "login"', locale: 'en' });

    const script = opened[0]?.script ?? '';
    expect(script).toContain("CLAUDE_CONFIG_DIR='/home/ana/.claude-work'");
    expect(script).toContain("'--model' 'opus' '--permission-mode' 'plan' 'Fix \"login\"'");
    expect(script).toContain('the project folder no longer exists');
  });

  test('uses the first account when there is no default, and a default one when none was discovered yet', async () => {
    const onlyWork = harness({ accounts: [WORK_ACCOUNT] });
    expect((await onlyWork.service.hire({ projectPath: project })).accountId).toBe('claude-work');

    const none = harness({ accounts: [] });
    expect((await none.service.hire({ projectPath: project })).accountId).toBe('claude');
    expect(none.opened[0]?.script).toContain('unset CLAUDE_CONFIG_DIR');
  });

  test('joins the room whose id is the resolved path of the folder, however the folder was spelled', async () => {
    const real = await realpath(project);
    await symlink(project, join(root, 'link'));
    const { service } = harness({ rooms: [real] });

    const viaLink = await service.hire({ projectPath: join(root, 'link') });
    const direct = await service.hire({ projectPath: project });

    expect(viaLink.projectId).toBe(real);
    expect(direct.projectId).toBe(real);
  });

  test('uses the resolved path as the room of a folder that has no room yet (what Claude Code reports as its cwd)', async () => {
    const { service } = harness();

    expect((await service.hire({ projectPath: project })).projectId).toBe(await realpath(project));
  });

  test('refuses a folder that is not absolute, missing or not a directory', async () => {
    const { service, opened } = harness();

    expect(await code(service.hire({ projectPath: 'relative/dir' }))).toEqual({ status: 400, error: 'invalid-projectPath' });
    expect(await code(service.hire({ projectPath: join(root, 'missing') }))).toEqual({ status: 404, error: 'project-not-found' });
    expect(await code(service.hire({ projectPath: join(project, '..', 'nope', 'x') }))).toEqual({ status: 404, error: 'project-not-found' });
    expect(opened).toHaveLength(0);
  });

  test('refuses an unknown account, including a demo account id', async () => {
    const { service, opened } = harness();

    expect(await code(service.hire({ projectPath: project, accountId: 'nope' }))).toEqual({ status: 400, error: 'unknown-account' });
    expect(await code(service.hire({ projectPath: project, accountId: 'demo-pessoal' }))).toEqual({ status: 400, error: 'unknown-account' });
    expect(opened).toHaveLength(0);
  });

  test('says so when claude cannot be found', async () => {
    const { service, opened } = harness({ claude: undefined });

    expect(await code(service.hire({ projectPath: project }))).toEqual({ status: 503, error: 'claude-not-found' });
    expect(opened).toHaveLength(0);
  });

  test.each([
    ['no-terminal', 503],
    ['terminal-failed', 502],
    ['unsupported-platform', 501],
  ] as const)('maps a %s launch failure to HTTP %i, registers nothing and removes the launcher folder', async (failure, status) => {
    const { service, registry } = harness({
      launcher: {
        open: async () => {
          throw new LaunchError(failure, 'boom');
        },
      },
    });

    expect(await code(service.hire({ projectPath: project, prompt: 'x' }))).toEqual({ status, error: failure });

    expect(registry.list(T0)).toEqual([]);
    expect((await readdir(root)).filter((name) => name.startsWith('ai-office-hire-'))).toEqual([]);
  });

  test('limits launches per minute and counts only requests that reach the launcher', async () => {
    const { service, opened, setClock } = harness({ limit: 2 });
    await code(service.hire({ projectPath: join(root, 'missing') }));
    await service.hire({ projectPath: project });
    await service.hire({ projectPath: project });

    expect(await code(service.hire({ projectPath: project }))).toEqual({ status: 429, error: 'rate-limited' });
    expect(opened).toHaveLength(2);

    setClock(T0 + 60_000);
    await service.hire({ projectPath: project });
    expect(opened).toHaveLength(3);
  });

  test('keeps the placeholder for the whole match window', async () => {
    const { service, registry } = harness();

    const hire = await service.hire({ projectPath: project });

    expect(hire.expiresAt - hire.createdAt).toBe(HIRE_WINDOW_MS);
    expect(registry.list(T0 + HIRE_WINDOW_MS - 1)).toHaveLength(1);
  });
});

describe('HireService.hire (demo mode)', () => {
  const demoPath = '/Users/demo/projetos/loja-online';

  test('simulates the hire without opening a terminal, even for a folder that does not exist', async () => {
    const demo = createDemoSimulator({ sessions: 1, seed: 3, now: () => T0 });
    const { service, opened } = harness({ demo, claude: undefined });

    const hire = await service.hire({ projectPath: demoPath, accountId: 'demo-trabalho', prompt: 'Revisar o checkout', deskIndex: 1 });

    expect(opened).toHaveLength(0);
    expect(hire).toMatchObject({ demo: true, projectId: demoPath, accountId: 'demo-trabalho', deskIndex: 1 });
    expect(demo.hires(T0)).toEqual([hire]);
    expect(existsSync(demoPath)).toBe(false);
  });

  test('still launches for a room that holds real sessions', async () => {
    const demo = createDemoSimulator({ sessions: 1, seed: 3, now: () => T0 });
    const { service, opened } = harness({ demo, rooms: [project] });

    const hire = await service.hire({ projectPath: project });

    expect(opened).toHaveLength(1);
    expect(hire.demo).toBeUndefined();
  });

  test('is rate limited like real hires', async () => {
    const demo = createDemoSimulator({ sessions: 1, seed: 3, now: () => T0 });
    const { service } = harness({ demo, limit: 1 });
    await service.hire({ projectPath: demoPath });

    expect(await code(service.hire({ projectPath: demoPath }))).toEqual({ status: 429, error: 'rate-limited' });
  });
});

describe('HireService.check', () => {
  test('reports whether a folder can host an agent', async () => {
    const { service } = harness();

    expect(await service.check(project)).toEqual({ ok: true });
    expect(await service.check(join(root, 'missing'))).toEqual({ ok: false, reason: 'not-found' });
    expect(await service.check('relative')).toEqual({ ok: false, reason: 'not-absolute' });
  });

  test('accepts any absolute path while demo mode simulates hires, but not a missing real room', async () => {
    const demo = createDemoSimulator({ sessions: 1, seed: 3, now: () => T0 });
    const { service } = harness({ demo, rooms: [join(root, 'gone')] });

    expect(await service.check('/Users/demo/projetos/novo')).toEqual({ ok: true });
    expect(await service.check(join(root, 'gone'))).toEqual({ ok: false, reason: 'not-found' });
    expect(await service.check('relative')).toEqual({ ok: false, reason: 'not-absolute' });
  });
});
