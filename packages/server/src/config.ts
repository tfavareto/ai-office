// Server configuration from environment variables and CLI flags (flags win over env).
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DEFAULT_PORT } from '@ai-office/shared';
import type { LogLevel } from './log';

export interface ServerConfig {
  port: number;
  host: string;
  /** AI_OFFICE_ALLOW_REMOTE=1: allow a non-loopback `host`. Browsers still cannot sign in remotely (no cookie is issued). */
  allowRemote: boolean;
  /** Explicit Claude config dirs (AI_OFFICE_CLAUDE_DIRS); undefined means auto-discovery. */
  claudeDirs: string[] | undefined;
  stateDir: string;
  demo: boolean;
  /** Directory with the built web app. */
  webDir: string;
  logLevel: LogLevel;
  homeDir: string;
}

export class ConfigError extends Error {}

const FLAG_NAMES = new Set(['--port', '--host', '--demo', '--state-dir', '--claude-dirs', '--web-dir', '--quiet', '--debug', '--allow-remote']);
const BOOLEAN_FLAGS = new Set(['--demo', '--quiet', '--debug', '--allow-remote']);

/** Parses `--flag value`, `--flag=value` and boolean flags. Unknown flags are rejected. */
export function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    if (!FLAG_NAMES.has(name)) throw new ConfigError(`Opção desconhecida: ${arg}`);
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, eq >= 0 ? arg.slice(eq + 1) : '1');
      continue;
    }
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) throw new ConfigError(`A opção ${name} precisa de um valor`);
    flags.set(name, value);
  }
  return flags;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`Porta inválida: ${raw}`);
  return port;
}

function isTruthy(raw: string | undefined): boolean {
  return raw !== undefined && raw !== '' && raw !== '0' && raw.toLowerCase() !== 'false';
}

function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(path);
}

export function loadConfig(env: NodeJS.ProcessEnv, argv: readonly string[], defaultWebDir: string): ServerConfig {
  const flags = parseFlags(argv);
  const homeDir = env.HOME ?? homedir();
  const dirsRaw = flags.get('--claude-dirs') ?? env.AI_OFFICE_CLAUDE_DIRS;
  const claudeDirs = dirsRaw
    ?.split(',')
    .map((dir) => dir.trim())
    .filter((dir) => dir.length > 0)
    .map((dir) => expandHome(dir, homeDir));
  let logLevel: LogLevel = 'info';
  if (isTruthy(flags.get('--quiet')) || env.AI_OFFICE_LOG === 'quiet') logLevel = 'quiet';
  if (isTruthy(flags.get('--debug')) || env.AI_OFFICE_LOG === 'debug') logLevel = 'debug';
  const host = flags.get('--host') ?? env.AI_OFFICE_HOST ?? '127.0.0.1';
  const allowRemote = flags.has('--allow-remote') ? isTruthy(flags.get('--allow-remote')) : isTruthy(env.AI_OFFICE_ALLOW_REMOTE);
  if (!isLoopbackHost(host) && !allowRemote) {
    throw new ConfigError(`Recusando escutar em ${host}: só endereços locais são permitidos. Defina AI_OFFICE_ALLOW_REMOTE=1 para aceitar outro endereço (acesso remoto pelo navegador não é suportado).`);
  }
  return {
    port: parsePort(flags.get('--port') ?? env.AI_OFFICE_PORT),
    host,
    allowRemote,
    claudeDirs: claudeDirs !== undefined && claudeDirs.length > 0 ? claudeDirs : undefined,
    stateDir: expandHome(flags.get('--state-dir') ?? env.AI_OFFICE_STATE_DIR ?? join(homeDir, '.ai-office'), homeDir),
    demo: flags.has('--demo') ? isTruthy(flags.get('--demo')) : isTruthy(env.AI_OFFICE_DEMO),
    webDir: expandHome(flags.get('--web-dir') ?? env.AI_OFFICE_WEB_DIR ?? defaultWebDir, homeDir),
    logLevel,
    homeDir,
  };
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True for localhost, 127.0.0.0/8 and ::1 (with or without brackets). */
export function isLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase();
  return LOOPBACK_NAMES.has(lower) || /^127(\.\d{1,3}){3}$/.test(lower);
}

/** True for the unspecified addresses that listen on every interface. */
export function isWildcardHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::' || host === '[::]';
}
