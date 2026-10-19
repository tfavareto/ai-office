#!/usr/bin/env node
// AI Office plugin installer: installs, updates, removes or reports the Claude Code plugin in every detected account.
//
//   node packages/plugins/scripts/install.mjs install   [--dry-run] [--account <dir>]... [--claude <cmd>]
//   node packages/plugins/scripts/install.mjs uninstall [--dry-run] [--account <dir>]... [--claude <cmd>]
//   node packages/plugins/scripts/install.mjs status    [--account <dir>]... [--claude <cmd>]
//
// Accounts are Claude Code config directories, detected like the AI Office server does: AI_OFFICE_CLAUDE_DIRS
// (comma-separated) when set, otherwise every ~/.claude* directory that contains `projects/` plus CLAUDE_CONFIG_DIR.
// `--account` (repeatable) replaces the detection. For each account the installer drives the public `claude plugin`
// CLI, setting CLAUDE_CONFIG_DIR for that account (it is removed for the default ~/.claude so the CLI uses its own
// default):
//
//   install    marketplace add <repo root> (or marketplace update when already added), then
//              plugin install ai-office@ai-office --scope user (or plugin update when the version differs)
//   uninstall  plugin uninstall ai-office@ai-office, then marketplace remove ai-office
//   status     reports the marketplace and the installed plugin version per account
//
// `--dry-run` prints the commands that would change something without running them (read-only probes still run).
// The planning functions are pure and exported for tests; the `claude` runner is injectable.

import { spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLUGIN_NAME = 'ai-office';
export const MARKETPLACE_NAME = 'ai-office';
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
const INSTALL_SCOPE = 'user';
const COMMAND_TIMEOUT_MS = 120_000;

const USAGE = `Usage: install.mjs <install|uninstall|status> [options]

Options:
  --dry-run          Show the commands that would change something, without running them
  --account <dir>    Claude Code config directory to use (repeatable; replaces auto-detection)
  --claude <cmd>     Claude Code executable (default: claude)
  -h, --help         Show this help`;

/**
 * @typedef {object} Account
 * @property {string} dir  Absolute config directory.
 * @property {boolean} isDefault  True for ~/.claude, where CLAUDE_CONFIG_DIR must not be set.
 */

/**
 * @typedef {object} ParsedArgs
 * @property {'install' | 'uninstall' | 'status' | null} command
 * @property {boolean} dryRun
 * @property {string[]} accounts
 * @property {string} claude
 * @property {boolean} help
 * @property {string | null} error
 */

/**
 * @param {string[]} argv  Arguments after the script name.
 * @returns {ParsedArgs}
 */
export function parseCliArgs(argv) {
  /** @type {ParsedArgs} */
  const result = { command: null, dryRun: false, accounts: [], claude: 'claude', help: false, error: null };
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean' },
        account: { type: 'string', multiple: true },
        claude: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    result.dryRun = values['dry-run'] === true;
    result.accounts = values.account ?? [];
    result.claude = values.claude ?? 'claude';
    result.help = values.help === true;
    const [command, ...extra] = positionals;
    if (result.help) return result;
    if (command !== 'install' && command !== 'uninstall' && command !== 'status') {
      result.error = command === undefined ? 'Missing command.' : `Unknown command "${command}".`;
    } else if (extra.length > 0) {
      result.error = `Unexpected argument "${extra[0]}".`;
    } else if (command === 'status' && result.dryRun) {
      result.error = '--dry-run does not apply to status (it never changes anything).';
    } else {
      result.command = command;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

/**
 * Expands a leading `~` and resolves against `cwd`.
 * @param {string} dir
 * @param {string} home
 * @param {string} cwd
 */
function resolveDir(dir, home, cwd) {
  if (dir === '~') return home;
  if (dir.startsWith('~/')) return join(home, dir.slice(2));
  return resolve(cwd, dir);
}

/** @param {string} path */
const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Every `~/.claude*` directory containing `projects/`, like the AI Office server's default discovery.
 * @param {string} home
 * @returns {string[]}
 */
function scanHome(home) {
  let names;
  try {
    names = readdirSync(home);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.startsWith('.claude'))
    .sort()
    .map((name) => join(home, name))
    .filter((dir) => isDirectory(join(dir, 'projects')));
}

/**
 * Finds the Claude Code accounts to operate on.
 * @param {object} options
 * @param {string[]} [options.explicit]  Values of --account.
 * @param {NodeJS.ProcessEnv} options.env
 * @param {string} options.home
 * @param {string} [options.cwd]
 * @returns {Account[]}
 */
export function detectAccounts({ explicit = [], env, home, cwd = process.cwd() }) {
  const defaultDir = resolve(home, '.claude');
  /** @type {string[]} */
  let candidates;
  if (explicit.length > 0) {
    candidates = explicit;
  } else if (env.AI_OFFICE_CLAUDE_DIRS?.trim()) {
    candidates = env.AI_OFFICE_CLAUDE_DIRS.split(',');
  } else {
    candidates = [...scanHome(home), ...(env.CLAUDE_CONFIG_DIR ? [env.CLAUDE_CONFIG_DIR] : [])];
  }
  const dirs = candidates
    .map((dir) => dir.trim())
    .filter((dir) => dir !== '')
    .map((dir) => resolveDir(dir, home, cwd));
  const unique = [...new Set(dirs)];
  return unique.map((dir) => ({ dir, isDefault: dir === defaultDir }));
}

/**
 * Environment for a `claude` call on behalf of one account.
 * @param {NodeJS.ProcessEnv} base
 * @param {Account} account
 * @returns {NodeJS.ProcessEnv}
 */
export function accountEnv(base, account) {
  const env = { ...base };
  if (account.isDefault) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = account.dir;
  return env;
}

/**
 * Finds the AI Office plugin in the output of `claude plugin list --json`.
 * @param {string} stdout
 * @returns {{ installed: boolean, version?: string, enabled?: boolean }}
 */
export function parseInstalledPlugin(stdout) {
  const entries = parseJsonList(stdout, 'plugins');
  const entry = entries.find(
    (item) =>
      item?.id === PLUGIN_ID ||
      item?.name === PLUGIN_ID ||
      (item?.name === PLUGIN_NAME && item?.marketplace === MARKETPLACE_NAME),
  );
  if (!entry) return { installed: false };
  return {
    installed: true,
    ...(typeof entry.version === 'string' ? { version: entry.version } : {}),
    ...(typeof entry.enabled === 'boolean' ? { enabled: entry.enabled } : {}),
  };
}

/**
 * Whether the AI Office marketplace appears in `claude plugin marketplace list --json`.
 * @param {string} stdout
 * @returns {boolean}
 */
export function parseMarketplaceAdded(stdout) {
  return parseJsonList(stdout, 'marketplaces').some((item) => item?.name === MARKETPLACE_NAME);
}

/**
 * Accepts either a JSON array or an object wrapping the array under `key`.
 * @param {string} stdout
 * @param {string} key
 * @returns {any[]}
 */
function parseJsonList(stdout, key) {
  try {
    const value = JSON.parse(stdout);
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value[key])) return value[key];
  } catch {
    // Not JSON: treated as "nothing found".
  }
  return [];
}

/**
 * @typedef {object} Step
 * @property {string} label  Human description.
 * @property {string[]} args  Arguments for the `claude` executable.
 * @property {boolean} [optional]  A failure is reported but does not stop the account's remaining steps.
 */

/**
 * @typedef {object} AccountState
 * @property {boolean} marketplaceAdded
 * @property {{ installed: boolean, version?: string, enabled?: boolean }} plugin
 */

/**
 * Steps needed to install or update the plugin.
 * @param {{ state: AccountState, pluginVersion: string, repoRoot: string }} options
 * @returns {Step[]}
 */
export function planInstall({ state, pluginVersion, repoRoot }) {
  /** @type {Step[]} */
  const steps = [];
  steps.push(
    state.marketplaceAdded
      ? {
          label: 'Refresh the marketplace',
          args: ['plugin', 'marketplace', 'update', MARKETPLACE_NAME],
          optional: true,
        }
      : { label: 'Add the marketplace', args: ['plugin', 'marketplace', 'add', repoRoot] },
  );
  if (!state.plugin.installed) {
    steps.push({ label: `Install ${PLUGIN_ID}`, args: ['plugin', 'install', PLUGIN_ID, '--scope', INSTALL_SCOPE] });
  } else if (state.plugin.version !== pluginVersion) {
    steps.push({
      label: `Update ${PLUGIN_ID} (${state.plugin.version ?? 'unknown'} -> ${pluginVersion})`,
      args: ['plugin', 'update', PLUGIN_ID, '--scope', INSTALL_SCOPE],
    });
  }
  return steps;
}

/**
 * Steps needed to remove the plugin and its marketplace.
 * @param {{ state: AccountState }} options
 * @returns {Step[]}
 */
export function planUninstall({ state }) {
  /** @type {Step[]} */
  const steps = [];
  if (state.plugin.installed) {
    steps.push({ label: `Uninstall ${PLUGIN_ID}`, args: ['plugin', 'uninstall', PLUGIN_ID, '--scope', INSTALL_SCOPE] });
  }
  if (state.marketplaceAdded) {
    steps.push({ label: 'Remove the marketplace', args: ['plugin', 'marketplace', 'remove', MARKETPLACE_NAME] });
  }
  return steps;
}

/**
 * One-line status of an account.
 * @param {AccountState} state
 * @param {string} pluginVersion  Version shipped in this repository.
 * @returns {string[]}  Indented report lines.
 */
export function describeStatus(state, pluginVersion) {
  const { plugin } = state;
  let pluginLine;
  if (!plugin.installed) pluginLine = 'not installed';
  else {
    const version = plugin.version ?? 'unknown version';
    const freshness = plugin.version === pluginVersion ? 'up to date' : `update available: ${pluginVersion}`;
    pluginLine = `installed ${version} (${freshness})${plugin.enabled === false ? ', disabled' : ''}`;
  }
  return [`marketplace: ${state.marketplaceAdded ? 'added' : 'not added'}`, `plugin: ${pluginLine}`];
}

/**
 * @typedef {object} RunResult
 * @property {number | null} status  Exit code, or null when the process could not run.
 * @property {string} stdout
 * @property {string} stderr
 * @property {string} [spawnError]  e.g. ENOENT when the executable does not exist.
 */

/**
 * @typedef {(command: string, args: string[], env: NodeJS.ProcessEnv) => RunResult} Runner
 */

/** @type {Runner} */
export const spawnRunner = (command, args, env) => {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error
      ? { spawnError: /** @type {NodeJS.ErrnoException} */ (result.error).code ?? result.error.message }
      : {}),
  };
};

/**
 * Reads the version of the plugin shipped in this repository and checks the marketplace file exists.
 * @param {string} repoRoot
 * @returns {string}
 */
export function readPluginVersion(repoRoot) {
  const manifest = join(repoRoot, 'packages', 'plugins', 'ai-office', '.claude-plugin', 'plugin.json');
  const marketplace = join(repoRoot, '.claude-plugin', 'marketplace.json');
  if (!existsSync(marketplace)) throw new Error(`Marketplace file not found: ${marketplace}`);
  const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
  if (typeof version !== 'string' || version === '') throw new Error(`Missing "version" in ${manifest}`);
  return version;
}

/**
 * @typedef {object} Deps
 * @property {Runner} runner
 * @property {NodeJS.ProcessEnv} env
 * @property {string} home
 * @property {string} cwd
 * @property {string} repoRoot
 * @property {(line: string) => void} log
 * @property {(line: string) => void} error
 */

/** @returns {Deps} */
function defaultDeps() {
  return {
    runner: spawnRunner,
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    repoRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
    log: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
  };
}

/** Where the native Claude Code installer puts the CLI (often missing from PATH in GUI-launched shells). */
const CLAUDE_FALLBACKS = ['.local/bin/claude', '.claude/local/claude'];

/** @param {string} path */
const isExecutableFile = (path) => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * The `claude` command to run: an explicit `--claude` is kept; the default `claude` is used when it is on PATH,
 * otherwise the first native install location that exists.
 * @param {{ command: string, env: NodeJS.ProcessEnv, home: string, isExecutable?: (path: string) => boolean }} options
 * @returns {string}
 */
export function resolveClaudeCommand({ command, env, home, isExecutable = isExecutableFile }) {
  if (command !== 'claude') return command;
  const onPath = (env.PATH ?? '').split(delimiter).some((dir) => dir !== '' && isExecutable(join(dir, command)));
  if (onPath) return command;
  return CLAUDE_FALLBACKS.map((rel) => join(home, rel)).find((path) => isExecutable(path)) ?? command;
}

/** Raised when the `claude` executable cannot be started. */
class ClaudeNotFoundError extends Error {
  /** @param {string} command */
  constructor(command) {
    super(
      `Could not run "${command}". Install the Claude Code CLI and make sure it is on your PATH, or pass --claude <path>.`,
    );
  }
}

/**
 * Runs the read-only probes that tell what is installed in an account.
 * @param {{ runner: Runner, claude: string, env: NodeJS.ProcessEnv }} options
 * @returns {AccountState}
 */
function probeAccount({ runner, claude, env }) {
  const plugins = runner(claude, ['plugin', 'list', '--json'], env);
  if (plugins.spawnError) throw new ClaudeNotFoundError(claude);
  if (plugins.status !== 0)
    throw new Error(`"claude plugin list" failed: ${plugins.stderr.trim() || `exit ${plugins.status}`}`);
  const marketplaces = runner(claude, ['plugin', 'marketplace', 'list', '--json'], env);
  if (marketplaces.status !== 0) {
    throw new Error(
      `"claude plugin marketplace list" failed: ${marketplaces.stderr.trim() || `exit ${marketplaces.status}`}`,
    );
  }
  return { plugin: parseInstalledPlugin(plugins.stdout), marketplaceAdded: parseMarketplaceAdded(marketplaces.stdout) };
}

/** @param {string[]} args */
const formatCommand = (args) =>
  `claude ${args.map((arg) => (/[\s"']/.test(arg) ? JSON.stringify(arg) : arg)).join(' ')}`;

/**
 * Runs the planned steps of one account. Returns false when a required step failed.
 * @param {{ steps: Step[], account: Account, deps: Deps, claude: string, dryRun: boolean }} options
 * @returns {boolean}
 */
function executeSteps({ steps, account, deps, claude, dryRun }) {
  const env = accountEnv(deps.env, account);
  for (const step of steps) {
    deps.log(`  ${dryRun ? '[dry-run] ' : ''}${step.label}: ${formatCommand(step.args)}`);
    if (dryRun) continue;
    const result = deps.runner(claude, step.args, env);
    if (result.status === 0) continue;
    const reason = result.spawnError ?? (result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`);
    if (step.optional) {
      deps.log(`  warning: ${step.label} failed (${reason}); continuing`);
      continue;
    }
    deps.error(`  failed: ${step.label}: ${reason}`);
    return false;
  }
  return true;
}

/**
 * CLI entry point. Returns the process exit code.
 * @param {string[]} argv  Arguments after the script name.
 * @param {Partial<Deps>} [overrides]  Dependency injection for tests.
 * @returns {number}
 */
export function main(argv, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const args = parseCliArgs(argv);
  if (args.help) {
    deps.log(USAGE);
    return 0;
  }
  if (args.error !== null || args.command === null) {
    deps.error(`${args.error ?? 'Invalid arguments.'}\n\n${USAGE}`);
    return 2;
  }

  let pluginVersion;
  try {
    pluginVersion = readPluginVersion(deps.repoRoot);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const accounts = detectAccounts({ explicit: args.accounts, env: deps.env, home: deps.home, cwd: deps.cwd });
  if (accounts.length === 0) {
    deps.error('No Claude Code account found (no ~/.claude* directory with projects/). Pass --account <dir>.');
    return 1;
  }

  const claude = resolveClaudeCommand({ command: args.claude, env: deps.env, home: deps.home });
  let failed = false;
  for (const account of accounts) {
    deps.log(`Account ${account.dir}${account.isDefault ? ' (default)' : ''}`);
    try {
      const state = probeAccount({ runner: deps.runner, claude, env: accountEnv(deps.env, account) });
      if (args.command === 'status') {
        for (const line of describeStatus(state, pluginVersion)) deps.log(`  ${line}`);
        continue;
      }
      const steps =
        args.command === 'install'
          ? planInstall({ state, pluginVersion, repoRoot: deps.repoRoot })
          : planUninstall({ state });
      if (steps.length === 0) {
        deps.log(args.command === 'install' ? `  already up to date (${pluginVersion})` : '  nothing to remove');
        continue;
      }
      if (!executeSteps({ steps, account, deps, claude, dryRun: args.dryRun })) failed = true;
    } catch (error) {
      if (error instanceof ClaudeNotFoundError) {
        deps.error(error.message);
        return 1;
      }
      deps.error(`  ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
    }
  }
  if (!failed && args.command !== 'status') {
    deps.log(
      args.dryRun
        ? 'Dry run: nothing was changed.'
        : args.command === 'install'
          ? 'Done. Restart running Claude Code sessions to load the hooks.'
          : 'Done.',
    );
  }
  return failed ? 1 : 0;
}

/** @returns {boolean} */
function isEntryPoint() {
  try {
    return process.argv[1] !== undefined && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2));
}
