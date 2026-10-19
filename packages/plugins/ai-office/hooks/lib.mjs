// Shared runtime of the AI Office hook scripts (permission.mjs, messages.mjs, notify.mjs).
//
// Claude Code copies only the plugin folder into its cache, so this file sits next to the scripts and imports nothing
// but `node:*` modules. It provides the pieces every hook needs:
//
//   - configuration from the environment (AI_OFFICE_PORT, AI_OFFICE_STATE_DIR, AI_OFFICE_HOOK_DEBUG);
//   - the access token (`<state dir>/token`, written by the server). Without it the hooks behave as if AI Office were
//     offline. Before the token is sent anywhere the server must prove it knows it (challenge on /api/health), so a
//     stranger listening on the port never sees it, and a 401 is treated as "offline" too: never auto-approve;
//   - a size- and time-bounded stdin reader;
//   - a tiny JSON-over-HTTP client that only ever talks to 127.0.0.1 and never throws;
//   - `runHook`, the entry-point wrapper that enforces the golden rule of the plugin: a hook must never fail or stall
//     a Claude Code session. Any error, timeout or "AI Office is not running" ends in `exit 0` with no output.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Interface languages of AI Office (same as `LOCALES` in @ai-office/shared; the plugin cannot import it at runtime). */
export const LOCALES = ['pt-BR', 'en', 'es'];
/** Language used for what is said to the agent when the page did not say which one it speaks. */
export const DEFAULT_LOCALE = 'pt-BR';

/**
 * A supported locale, or `DEFAULT_LOCALE` for anything else (absent, unknown, not a string).
 * @param {unknown} value
 * @returns {'pt-BR' | 'en' | 'es'}
 */
export function normalizeLocale(value) {
  return typeof value === 'string' && LOCALES.includes(value) ? /** @type {'pt-BR' | 'en' | 'es'} */ (value) : DEFAULT_LOCALE;
}

/** Same default as `DEFAULT_PORT` in @ai-office/shared (the plugin cannot import it at runtime). */
export const DEFAULT_PORT = 4848;
/** Hooks only ever talk to the local machine. */
export const HOST = '127.0.0.1';

/** Same values as `TOKEN_FILE_NAME` / `HEALTH_PROOF_PREFIX` in @ai-office/shared. */
export const TOKEN_FILE_NAME = 'token';
export const HEALTH_PROOF_PREFIX = 'ai-office/health/v1:';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export const STDIN_TIMEOUT_MS = 5_000;
export const STDIN_MAX_BYTES = 4 * 1024 * 1024;
/** Upper bound for the plain, non-polling requests (create, inbox, attention). Offline fails far sooner (ECONNREFUSED). */
export const QUICK_REQUEST_TIMEOUT_MS = 3_000;
/** Extra seconds granted to a long-poll request on top of the wait it asked the server for. */
export const LONG_POLL_GRACE_MS = 5_000;
/** Longest wait the server accepts per long-poll request. */
export const LONG_POLL_STEP_SECONDS = 25;
/** Consecutive failed long-polls tolerated before giving up. */
export const MAX_POLL_FAILURES = 3;
export const POLL_RETRY_DELAY_MS = 1_000;
/** Margin added to the expected runtime of a hook before the safety timer force-exits it. */
const SAFETY_MARGIN_MS = 10_000;
const STDOUT_FLUSH_TIMEOUT_MS = 1_000;

/**
 * Parses a numeric environment value, clamping it to [min, max]. Empty or non-numeric values give `fallback`.
 * @param {string | undefined} raw
 * @param {{ fallback: number, min: number, max: number }} limits
 * @returns {number}
 */
export function readNumber(raw, { fallback, min, max }) {
  if (typeof raw !== 'string' || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Port of the AI Office server (AI_OFFICE_PORT, default 4848).
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
export function resolvePort(env) {
  const raw = env.AI_OFFICE_PORT;
  const port = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : DEFAULT_PORT;
}

/**
 * Path of the token file: `$AI_OFFICE_STATE_DIR/token`, else `~/.ai-office/token`.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function resolveTokenPath(env) {
  const home = env.HOME || homedir();
  const dir = typeof env.AI_OFFICE_STATE_DIR === 'string' && env.AI_OFFICE_STATE_DIR !== '' ? env.AI_OFFICE_STATE_DIR : join(home, '.ai-office');
  const expanded = dir === '~' ? home : dir.startsWith('~/') ? join(home, dir.slice(2)) : dir;
  return join(expanded, TOKEN_FILE_NAME);
}

/**
 * Reads the access token. `null` when the file is missing, unreadable or malformed ("AI Office offline").
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function readToken(env) {
  try {
    const token = readFileSync(resolveTokenPath(env), 'utf8').trim();
    return TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} HookContext
 * @property {NodeJS.ProcessEnv} env
 * @property {string} baseUrl  e.g. http://127.0.0.1:4848
 * @property {string | null} token  Access token, or null when it cannot be read (then no request is ever made).
 * @property {Promise<boolean>} [serverVerified]  Cached result of the server identity check.
 * @property {(...parts: unknown[]) => void} debug  Writes to stderr when AI_OFFICE_HOOK_DEBUG=1.
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} scope  Script name used as the debug-log prefix.
 * @param {(line: string) => void} [writeLine]  Debug sink (stderr by default).
 * @returns {HookContext}
 */
export function createContext(env, scope, writeLine = (line) => process.stderr.write(line)) {
  const enabled = env.AI_OFFICE_HOOK_DEBUG === '1';
  return {
    env,
    baseUrl: `http://${HOST}:${resolvePort(env)}`,
    token: readToken(env),
    debug: (...parts) => {
      if (!enabled) return;
      const text = parts.map((part) => (part instanceof Error ? part.message : String(part))).join(' ');
      writeLine(`[ai-office:${scope}] ${text}\n`);
    },
  };
}

/**
 * Reads the whole stream as text. Resolves with `null` on timeout, overflow or stream error, so a hook that never
 * receives its input (or receives a flood) just gives up.
 * @param {NodeJS.ReadableStream} [stream]
 * @param {{ timeoutMs?: number, maxBytes?: number }} [limits]
 * @returns {Promise<string | null>}
 */
export function readStdin(stream = process.stdin, { timeoutMs = STDIN_TIMEOUT_MS, maxBytes = STDIN_MAX_BYTES } = {}) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let settled = false;
    /** @param {string | null} value */
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('error', onError);
      resolve(value);
    };
    /** @param {Buffer | string} chunk */
    const onData = (chunk) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += buffer.length;
      if (size > maxBytes) return finish(null);
      chunks.push(buffer);
    };
    const onEnd = () => finish(Buffer.concat(chunks).toString('utf8'));
    const onError = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

/**
 * Parses hook input, which must be a JSON object.
 * @param {string | null} text
 * @returns {Record<string, any> | null}
 */
export function parseHookInput(text) {
  if (!text || text.trim() === '') return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Builds a query string, skipping undefined, null and empty values.
 * @param {Record<string, string | number | undefined | null>} params
 * @returns {string}  `?a=1&b=2`, or an empty string.
 */
export function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * @typedef {object} HttpResult
 * @property {number} status
 * @property {boolean} ok
 * @property {any} json  Parsed body, or null when it is empty or not JSON.
 */

/**
 * Checks, once per process, that the server on the port knows the token: it must answer a random challenge with the
 * HMAC of the token. The token itself is not sent for this check.
 * @param {HookContext} ctx
 * @returns {Promise<boolean>}
 */
export function verifyServer(ctx) {
  if (ctx.token === null) return Promise.resolve(false);
  ctx.serverVerified ??= (async () => {
    const token = /** @type {string} */ (ctx.token);
    try {
      const nonce = randomBytes(16).toString('hex');
      const response = await fetch(`${ctx.baseUrl}/api/health?challenge=${nonce}`, { signal: AbortSignal.timeout(QUICK_REQUEST_TIMEOUT_MS) });
      /** @type {any} */
      const json = response.ok ? await response.json() : null;
      const expected = createHmac('sha256', token).update(HEALTH_PROOF_PREFIX + nonce).digest();
      const proof = typeof json?.proof === 'string' && /^[0-9a-f]{64}$/.test(json.proof) ? Buffer.from(json.proof, 'hex') : null;
      const verified = proof !== null && timingSafeEqual(proof, expected);
      if (!verified) ctx.debug('server did not prove it knows the token, treating AI Office as offline');
      return verified;
    } catch (error) {
      ctx.debug('server check failed:', error);
      return false;
    }
  })();
  return ctx.serverVerified;
}

/**
 * Sends a request to the local AI Office server with the access token. Never throws: network errors, timeouts,
 * aborted bodies, a missing token, an unverified server and a 401 all yield `null`, which callers treat as
 * "AI Office unavailable".
 * @param {HookContext} ctx
 * @param {'GET' | 'POST'} method
 * @param {string} path  Path plus optional query string.
 * @param {{ body?: unknown, timeoutMs?: number }} [options]
 * @returns {Promise<HttpResult | null>}
 */
export async function requestJson(ctx, method, path, { body, timeoutMs = QUICK_REQUEST_TIMEOUT_MS } = {}) {
  try {
    if (ctx.token === null) {
      ctx.debug('no access token, AI Office is offline');
      return null;
    }
    if (!(await verifyServer(ctx))) return null;
    const hasBody = body !== undefined;
    const response = await fetch(`${ctx.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${ctx.token}`, ...(hasBody ? { 'content-type': 'application/json' } : {}) },
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401) {
      ctx.debug(method, path, '-> 401, token rejected');
      return null;
    }
    const text = await response.text();
    /** @type {any} */
    let json = null;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    ctx.debug(method, path, '->', response.status);
    return { status: response.status, ok: response.ok, json };
  } catch (error) {
    ctx.debug(method, path, 'failed:', error);
    return null;
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes `text` to stdout and resolves once it has been flushed (or after a short grace period).
 * @param {string} text
 * @param {NodeJS.WritableStream} [stream]
 * @returns {Promise<void>}
 */
function writeFlushed(text, stream = process.stdout) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, STDOUT_FLUSH_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    stream.once('error', done);
    stream.write(text, done);
  });
}

/**
 * Entry-point wrapper shared by all hooks. Reads the hook input, runs `handler` and prints its JSON result. The
 * process always ends with exit code 0: `null` (or any failure) means "no output, let Claude Code carry on".
 * @param {object} options
 * @param {string} options.scope  Script name for the debug log.
 * @param {number} options.budgetMs  Expected worst-case runtime of the handler; a safety timer force-exits after
 *   this budget plus stdin and margin time.
 * @param {(input: Record<string, any>, ctx: HookContext) => Promise<Record<string, unknown> | null>} options.handler
 * @returns {Promise<never>}
 */
export async function runHook({ scope, budgetMs, handler }) {
  const ctx = createContext(process.env, scope);
  const safety = setTimeout(
    () => {
      ctx.debug('safety timer fired, exiting');
      process.exit(0);
    },
    STDIN_TIMEOUT_MS + budgetMs + SAFETY_MARGIN_MS,
  );
  safety.unref();

  /** @type {Record<string, unknown> | null} */
  let output = null;
  try {
    const input = parseHookInput(await readStdin());
    if (input === null) ctx.debug('no valid hook input on stdin');
    else output = await handler(input, ctx);
  } catch (error) {
    ctx.debug('unexpected error:', error);
    output = null;
  }
  if (output !== null) await writeFlushed(`${JSON.stringify(output)}\n`);
  process.exit(0);
}

/**
 * True when the module at `metaUrl` (its `import.meta.url`) is the script Node was started with, so a hook file can
 * export pure helpers for tests and only run when executed.
 * @param {string} metaUrl
 * @param {string | undefined} [entry]  Defaults to process.argv[1].
 * @returns {boolean}
 */
export function isEntryPoint(metaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === metaUrl;
  } catch {
    return false;
  }
}
