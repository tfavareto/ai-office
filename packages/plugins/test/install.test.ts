import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  PLUGIN_ID,
  accountEnv,
  describeStatus,
  detectAccounts,
  main,
  parseCliArgs,
  parseInstalledPlugin,
  parseMarketplaceAdded,
  planInstall,
  planUninstall,
  readPluginVersion,
  resolveClaudeCommand,
} from '../scripts/install.mjs';
import { REPO_ROOT } from './helpers';

const VERSION = '0.1.0';
const NOT_INSTALLED = { marketplaceAdded: false, plugin: { installed: false } };

describe('parseCliArgs', () => {
  test('parses command and options', () => {
    expect(
      parseCliArgs(['install', '--dry-run', '--account', '/a', '--account', '/b', '--claude', '/bin/c']),
    ).toMatchObject({
      command: 'install',
      dryRun: true,
      accounts: ['/a', '/b'],
      claude: '/bin/c',
      error: null,
    });
    expect(parseCliArgs(['status']).claude).toBe('claude');
  });

  test('reports errors for a missing or unknown command, extras and unknown flags', () => {
    expect(parseCliArgs([]).error).toMatch(/Missing command/);
    expect(parseCliArgs(['explode']).error).toMatch(/Unknown command/);
    expect(parseCliArgs(['install', 'now']).error).toMatch(/Unexpected argument/);
    expect(parseCliArgs(['install', '--nope']).error).toBeTruthy();
    expect(parseCliArgs(['status', '--dry-run']).error).toMatch(/does not apply/);
    expect(parseCliArgs(['--help']).help).toBe(true);
  });
});

describe('detectAccounts', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ai-office-home-'));
    for (const name of ['.claude', '.claude-work']) mkdirSync(join(home, name, 'projects'), { recursive: true });
    mkdirSync(join(home, '.claude-empty'));
    writeFileSync(join(home, '.claude.json'), '{}');
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  test('scans ~/.claude* directories containing projects/', () => {
    expect(detectAccounts({ env: {}, home })).toEqual([
      { dir: join(home, '.claude'), isDefault: true },
      { dir: join(home, '.claude-work'), isDefault: false },
    ]);
  });

  test('uses the same names as the server: .claude and .claude-<name> only', () => {
    for (const name of ['.claude_backup', '.claudeold']) mkdirSync(join(home, name, 'projects'), { recursive: true });
    expect(detectAccounts({ env: {}, home }).map((a) => a.dir)).toEqual([join(home, '.claude'), join(home, '.claude-work')]);
  });

  test('adds CLAUDE_CONFIG_DIR without duplicating', () => {
    const extra = join(home, 'elsewhere');
    const accounts = detectAccounts({ env: { CLAUDE_CONFIG_DIR: extra }, home });
    expect(accounts.map((a) => a.dir)).toEqual([join(home, '.claude'), join(home, '.claude-work'), extra]);
    expect(detectAccounts({ env: { CLAUDE_CONFIG_DIR: join(home, '.claude') }, home })).toHaveLength(2);
  });

  test('AI_OFFICE_CLAUDE_DIRS replaces the scan; --account replaces both', () => {
    const env = { AI_OFFICE_CLAUDE_DIRS: `${join(home, '.claude-empty')}, ~/custom` };
    expect(detectAccounts({ env, home }).map((a) => a.dir)).toEqual([
      join(home, '.claude-empty'),
      join(home, 'custom'),
    ]);
    expect(detectAccounts({ explicit: ['./rel'], env, home, cwd: '/work' }).map((a) => a.dir)).toEqual(['/work/rel']);
  });

  test('returns nothing when no account exists', () => {
    expect(detectAccounts({ env: {}, home: join(home, 'nowhere') })).toEqual([]);
  });
});

describe('resolveClaudeCommand', () => {
  const home = '/home/u';
  const onDisk = (...paths: string[]) => (path: string) => paths.includes(path);

  test('keeps an explicit --claude command untouched', () => {
    expect(resolveClaudeCommand({ command: '/opt/claude', env: { PATH: '' }, home, isExecutable: onDisk() })).toBe('/opt/claude');
  });

  test('uses the PATH lookup when claude is on PATH', () => {
    const env = { PATH: '/usr/bin:/home/u/bin' };
    expect(resolveClaudeCommand({ command: 'claude', env, home, isExecutable: onDisk('/home/u/bin/claude', '/home/u/.local/bin/claude') })).toBe('claude');
  });

  test('falls back to the native installer location when claude is not on PATH', () => {
    expect(resolveClaudeCommand({ command: 'claude', env: { PATH: '/usr/bin' }, home, isExecutable: onDisk('/home/u/.local/bin/claude') })).toBe(
      '/home/u/.local/bin/claude',
    );
    expect(resolveClaudeCommand({ command: 'claude', env: {}, home, isExecutable: onDisk('/home/u/.claude/local/claude') })).toBe(
      '/home/u/.claude/local/claude',
    );
  });

  test('returns the bare command when nothing is found (the run reports the error)', () => {
    expect(resolveClaudeCommand({ command: 'claude', env: { PATH: '/usr/bin' }, home, isExecutable: onDisk() })).toBe('claude');
  });
});

describe('accountEnv', () => {
  test('sets CLAUDE_CONFIG_DIR for non-default accounts and removes it for the default one', () => {
    const base = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/leak' };
    expect(accountEnv(base, { dir: '/home/u/.claude-work', isDefault: false })).toEqual({
      PATH: '/bin',
      CLAUDE_CONFIG_DIR: '/home/u/.claude-work',
    });
    expect(accountEnv(base, { dir: '/home/u/.claude', isDefault: true })).toEqual({ PATH: '/bin' });
    expect(base.CLAUDE_CONFIG_DIR).toBe('/leak');
  });
});

describe('parsers', () => {
  test('parseInstalledPlugin reads arrays and wrapped lists', () => {
    const entry = { id: PLUGIN_ID, version: '0.0.9', enabled: false, scope: 'user' };
    expect(parseInstalledPlugin(JSON.stringify([{ id: 'other@x' }, entry]))).toEqual({
      installed: true,
      version: '0.0.9',
      enabled: false,
    });
    expect(parseInstalledPlugin(JSON.stringify({ plugins: [entry] })).installed).toBe(true);
    expect(
      parseInstalledPlugin(JSON.stringify([{ name: 'ai-office', marketplace: 'ai-office', version: '1' }])).installed,
    ).toBe(true);
    expect(parseInstalledPlugin(JSON.stringify([{ name: 'ai-office', marketplace: 'other' }])).installed).toBe(false);
    expect(parseInstalledPlugin('[]')).toEqual({ installed: false });
    expect(parseInstalledPlugin('garbage')).toEqual({ installed: false });
  });

  test('parseMarketplaceAdded', () => {
    expect(parseMarketplaceAdded(JSON.stringify([{ name: 'ai-office' }]))).toBe(true);
    expect(parseMarketplaceAdded(JSON.stringify([{ name: 'other' }]))).toBe(false);
    expect(parseMarketplaceAdded('')).toBe(false);
  });
});

describe('plans', () => {
  const repoRoot = '/repo';

  test('fresh install adds the marketplace and installs at user scope', () => {
    expect(planInstall({ state: NOT_INSTALLED, pluginVersion: VERSION, repoRoot }).map((s) => s.args)).toEqual([
      ['plugin', 'marketplace', 'add', '/repo'],
      ['plugin', 'install', PLUGIN_ID, '--scope', 'user'],
    ]);
  });

  test('update refreshes the marketplace and updates when the version differs', () => {
    const state = { marketplaceAdded: true, plugin: { installed: true, version: '0.0.1' } };
    const steps = planInstall({ state, pluginVersion: VERSION, repoRoot });
    expect(steps.map((s) => s.args)).toEqual([
      ['plugin', 'marketplace', 'update', 'ai-office'],
      ['plugin', 'update', PLUGIN_ID, '--scope', 'user'],
    ]);
    expect(steps[0].optional).toBe(true);
    expect(steps[1].label).toContain('0.0.1 -> 0.1.0');
  });

  test('same version only refreshes the marketplace', () => {
    const state = { marketplaceAdded: true, plugin: { installed: true, version: VERSION } };
    expect(planInstall({ state, pluginVersion: VERSION, repoRoot }).map((s) => s.args[1])).toEqual(['marketplace']);
  });

  test('installs when the marketplace exists but the plugin does not', () => {
    const state = { marketplaceAdded: true, plugin: { installed: false } };
    expect(planInstall({ state, pluginVersion: VERSION, repoRoot }).map((s) => s.args[1])).toEqual([
      'marketplace',
      'install',
    ]);
  });

  test('uninstall removes the plugin then the marketplace, skipping what is absent', () => {
    const both = { marketplaceAdded: true, plugin: { installed: true, version: VERSION } };
    expect(planUninstall({ state: both }).map((s) => s.args)).toEqual([
      ['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user'],
      ['plugin', 'marketplace', 'remove', 'ai-office'],
    ]);
    expect(planUninstall({ state: NOT_INSTALLED })).toEqual([]);
  });

  test('describeStatus', () => {
    expect(describeStatus(NOT_INSTALLED, VERSION)).toEqual(['marketplace: not added', 'plugin: not installed']);
    const old = { marketplaceAdded: true, plugin: { installed: true, version: '0.0.1', enabled: false } };
    expect(describeStatus(old, VERSION)[1]).toBe('plugin: installed 0.0.1 (update available: 0.1.0), disabled');
    const current = { marketplaceAdded: true, plugin: { installed: true, version: VERSION } };
    expect(describeStatus(current, VERSION)[1]).toBe('plugin: installed 0.1.0 (up to date)');
  });
});

/** In-memory stand-in for the `claude` CLI: tracks marketplace/plugin state per CLAUDE_CONFIG_DIR. */
class FakeClaude {
  readonly calls: { args: string[]; configDir: string | undefined }[] = [];
  private readonly accounts = new Map<string, { marketplace: boolean; version: string | null }>();
  failOn: string | null = null;

  seed(configDir: string | undefined, marketplace: boolean, version: string | null): void {
    this.accounts.set(configDir ?? 'default', { marketplace, version });
  }

  stateOf(configDir: string | undefined) {
    return this.accounts.get(configDir ?? 'default');
  }

  readonly runner = (_command: string, args: string[], env: NodeJS.ProcessEnv) => {
    const configDir = env.CLAUDE_CONFIG_DIR;
    this.calls.push({ args, configDir });
    const state = this.accounts.get(configDir ?? 'default') ?? { marketplace: false, version: null };
    this.accounts.set(configDir ?? 'default', state);
    const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    const [, verb, sub] = args;
    if (this.failOn === `${verb} ${sub ?? ''}`.trim()) return { status: 1, stdout: '', stderr: 'boom' };
    if (verb === 'list') {
      return ok(JSON.stringify(state.version ? [{ id: PLUGIN_ID, version: state.version, enabled: true }] : []));
    }
    if (verb === 'marketplace' && sub === 'list')
      return ok(JSON.stringify(state.marketplace ? [{ name: 'ai-office' }] : []));
    if (verb === 'marketplace' && sub === 'add') state.marketplace = true;
    if (verb === 'marketplace' && sub === 'remove') state.marketplace = false;
    if (verb === 'install' || verb === 'update') state.version = VERSION;
    if (verb === 'uninstall') state.version = null;
    return ok();
  };

  mutations() {
    return this.calls.filter(
      ({ args }) => !['list'].includes(args[1]) && !(args[1] === 'marketplace' && args[2] === 'list'),
    );
  }
}

describe('main (with a fake CLI)', () => {
  let home: string;
  let logs: string[];
  let errors: string[];
  let claude: FakeClaude;
  const run = (argv: string[], env: NodeJS.ProcessEnv = {}) =>
    main(argv, {
      runner: claude.runner,
      env: { PATH: '/bin', ...env },
      home,
      cwd: home,
      repoRoot: REPO_ROOT,
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    });

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ai-office-home-'));
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    mkdirSync(join(home, '.claude-work', 'projects'), { recursive: true });
    logs = [];
    errors = [];
    claude = new FakeClaude();
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  test('fresh install runs the plan in every account with the right CLAUDE_CONFIG_DIR', () => {
    expect(run(['install'])).toBe(0);

    const work = join(home, '.claude-work');
    expect(claude.mutations().map(({ args, configDir }) => [configDir, args.slice(1, 3).join(' ')])).toEqual([
      [undefined, `marketplace add`],
      [undefined, `install ${PLUGIN_ID}`],
      [work, `marketplace add`],
      [work, `install ${PLUGIN_ID}`],
    ]);
    expect(claude.mutations()[0].args[3]).toBe(REPO_ROOT);
    expect(claude.stateOf(undefined)).toEqual({ marketplace: true, version: VERSION });
    expect(logs.join('\n')).toContain('Restart running Claude Code sessions');
  });

  test('running install again is an update path that changes nothing when versions match', () => {
    run(['install']);
    claude.calls.length = 0;
    expect(run(['install'])).toBe(0);
    expect(claude.mutations().map(({ args }) => args.slice(1, 3).join(' '))).toEqual([
      'marketplace update',
      'marketplace update',
    ]);
  });

  test('an older installed version triggers plugin update', () => {
    claude.seed(undefined, true, '0.0.1');
    expect(run(['install', '--account', join(home, '.claude')])).toBe(0);
    expect(claude.mutations().map(({ args }) => args.slice(1, 3).join(' '))).toEqual([
      'marketplace update',
      `update ${PLUGIN_ID}`,
    ]);
  });

  test('dry run probes but never changes anything', () => {
    expect(run(['install', '--dry-run'])).toBe(0);
    expect(claude.mutations()).toEqual([]);
    expect(claude.stateOf(undefined)).toEqual({ marketplace: false, version: null });
    const output = logs.join('\n');
    expect(output).toContain('[dry-run] Add the marketplace: claude plugin marketplace add');
    expect(output).toContain('Dry run: nothing was changed.');
  });

  test('uninstall removes the plugin and marketplace', () => {
    claude.seed(undefined, true, VERSION);
    claude.seed(join(home, '.claude-work'), true, VERSION);
    expect(run(['uninstall'])).toBe(0);
    expect(claude.stateOf(undefined)).toEqual({ marketplace: false, version: null });
    expect(claude.stateOf(join(home, '.claude-work'))).toEqual({ marketplace: false, version: null });
  });

  test('uninstall dry run and nothing-to-remove', () => {
    claude.seed(undefined, true, VERSION);
    expect(run(['uninstall', '--dry-run', '--account', join(home, '.claude')])).toBe(0);
    expect(claude.mutations()).toEqual([]);
    logs.length = 0;
    expect(run(['uninstall', '--account', join(home, '.claude-work')])).toBe(0);
    expect(logs.join('\n')).toContain('nothing to remove');
  });

  test('status reports per account and runs no mutating command', () => {
    claude.seed(undefined, true, '0.0.1');
    expect(run(['status'])).toBe(0);
    const output = logs.join('\n');
    expect(output).toContain(`Account ${join(home, '.claude')} (default)`);
    expect(output).toContain('plugin: installed 0.0.1 (update available: 0.1.0)');
    expect(output).toContain('plugin: not installed');
    expect(claude.mutations()).toEqual([]);
  });

  test('a failing required step makes the exit code 1 and the other account still runs', () => {
    claude.failOn = 'install ai-office@ai-office';
    expect(run(['install'])).toBe(1);
    expect(errors.join('\n')).toContain('failed: Install ai-office@ai-office');
    expect(claude.mutations().filter(({ configDir }) => configDir !== undefined).length).toBeGreaterThan(0);
  });

  test('a missing claude executable is reported once', () => {
    const code = main(['status'], {
      runner: () => ({ status: null, stdout: '', stderr: '', spawnError: 'ENOENT' }),
      env: {},
      home,
      cwd: home,
      repoRoot: REPO_ROOT,
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    });
    expect(code).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Could not run "claude"/);
  });

  test('usage errors exit 2 and --help exits 0', () => {
    expect(run(['bogus'])).toBe(2);
    expect(errors.join('\n')).toContain('Usage:');
    expect(run(['--help'])).toBe(0);
  });

  test('no accounts found asks for --account', () => {
    expect(
      main(['install'], {
        runner: claude.runner,
        env: {},
        home: join(home, 'empty'),
        cwd: home,
        repoRoot: REPO_ROOT,
        log: (line) => logs.push(line),
        error: (line) => errors.push(line),
      }),
    ).toBe(1);
    expect(errors.join('\n')).toContain('--account');
  });
});

describe('readPluginVersion', () => {
  test('reads the repository plugin manifest', () => {
    expect(readPluginVersion(REPO_ROOT)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('fails clearly when the marketplace file is missing', () => {
    expect(() => readPluginVersion(tmpdir())).toThrow(/Marketplace file not found/);
  });
});
