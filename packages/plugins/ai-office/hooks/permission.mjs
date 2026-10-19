// PermissionRequest hook: lets the user answer Claude Code permission dialogs from the AI Office web app.
//
// Flow
//   1. Claude Code is about to show a permission dialog and runs this hook with the request as JSON on stdin.
//   2. The request (tool input trimmed to keep the body under 200 KB) is POSTed to /api/permissions. If AI Office is
//      offline, no page is open, or it answers `{ skip }`, the hook exits silently and the terminal dialog proceeds.
//   3. Otherwise the hook long-polls GET /api/permissions/:id/wait (25 s steps) until the user decides, the request
//      expires or is cancelled, or the total timeout elapses (300 s by default, AI_OFFICE_PERMISSION_TIMEOUT in
//      seconds, clamped to 5-1800).
//   4. A decision becomes the PermissionRequest hook output:
//        allow    -> { behavior: "allow" } plus the chosen original permission suggestion as `updatedPermissions`
//        deny     -> { behavior: "deny", message, interrupt }
//        terminal / expired / any error -> no output (the terminal dialog stays in charge; first answer wins).
//
// Environment: AI_OFFICE_PORT (default 4848), AI_OFFICE_PERMISSION_TIMEOUT, AI_OFFICE_HOOK_DEBUG=1.
// The script never fails a session: every problem ends in exit code 0 with empty stdout.

import {
  LONG_POLL_GRACE_MS,
  LONG_POLL_STEP_SECONDS,
  MAX_POLL_FAILURES,
  POLL_RETRY_DELAY_MS,
  isEntryPoint,
  readNumber,
  requestJson,
  runHook,
  sleep,
} from './lib.mjs';

/** Tools whose dialog is a question to the user, not a permission: the office cannot answer them. */
const SKIPPED_TOOLS = new Set(['AskUserQuestion']);

export const DEFAULT_TIMEOUT_SECONDS = 300;
const MIN_TIMEOUT_SECONDS = 5;
const MAX_TIMEOUT_SECONDS = 1800;

export const MAX_BODY_BYTES = 200 * 1024;
/** Per-string character limits tried in order until the whole body fits `MAX_BODY_BYTES`. */
export const STRING_LIMIT_STEPS = [8 * 1024, 4 * 1024, 2 * 1024, 1024, 512, 256];
const MAX_TRIM_DEPTH = 20;
const OMITTED_INPUT = { aviso: 'Entrada grande demais, omitida pelo plugin.' };

/**
 * Total time the hook may wait for an answer, in milliseconds.
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
export function resolveTimeoutMs(env) {
  const seconds = readNumber(env.AI_OFFICE_PERMISSION_TIMEOUT, {
    fallback: DEFAULT_TIMEOUT_SECONDS,
    min: MIN_TIMEOUT_SECONDS,
    max: MAX_TIMEOUT_SECONDS,
  });
  return Math.round(seconds * 1000);
}

/**
 * Returns a copy of `value` in which every string longer than `maxChars` is cut and marked as truncated.
 * @param {unknown} value
 * @param {number} maxChars
 * @param {number} [depth]
 * @returns {unknown}
 */
export function trimStrings(value, maxChars, depth = 0) {
  if (typeof value === 'string') return trimString(value, maxChars);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_TRIM_DEPTH) return '[profundidade excedida]';
  if (Array.isArray(value)) return value.map((item) => trimStrings(item, maxChars, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trimStrings(item, maxChars, depth + 1)]));
}

/**
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
function trimString(text, maxChars) {
  if (text.length <= maxChars) return text;
  let end = maxChars;
  const last = text.charCodeAt(end - 1);
  // Do not leave half of a surrogate pair at the cut.
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}… [+${text.length - end} caracteres omitidos]`;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
const byteSize = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');

/**
 * Builds the POST /api/permissions body from the hook input, shrinking tool_input strings until it fits in
 * `MAX_BODY_BYTES`. Returns `null` when even an omitted input would not fit (never skips the suggestions).
 * @param {Record<string, any>} input
 * @param {number} timeoutMs
 * @returns {Record<string, unknown> | null}
 */
export function buildPermissionBody(input, timeoutMs) {
  const base = {
    session_id: input.session_id,
    tool_name: input.tool_name,
    ...(Array.isArray(input.permission_suggestions) ? { permission_suggestions: input.permission_suggestions } : {}),
    ...(typeof input.agent_id === 'string' && input.agent_id !== '' ? { agent_id: input.agent_id } : {}),
    ...(typeof input.cwd === 'string' ? { cwd: input.cwd } : {}),
    timeout_ms: timeoutMs,
  };
  for (const limit of STRING_LIMIT_STEPS) {
    const body = { ...base, tool_input: trimStrings(input.tool_input ?? {}, limit) };
    if (byteSize(body) <= MAX_BODY_BYTES) return body;
  }
  const fallback = { ...base, tool_input: OMITTED_INPUT };
  return byteSize(fallback) <= MAX_BODY_BYTES ? fallback : null;
}

/**
 * Converts the user's decision into the hook output (or `null` when the terminal should answer).
 * @param {{ behavior?: string, suggestion?: number, message?: string, interrupt?: boolean }} decision
 * @param {unknown[] | undefined} suggestions  The original `permission_suggestions` of the request.
 * @returns {Record<string, unknown> | null}
 */
export function buildDecisionOutput(decision, suggestions) {
  if (decision.behavior === 'allow') {
    const index = decision.suggestion;
    const chosen =
      Number.isInteger(index) && Array.isArray(suggestions) ? suggestions[/** @type {number} */ (index)] : undefined;
    return hookOutput({
      behavior: 'allow',
      ...(chosen !== undefined ? { updatedPermissions: [chosen] } : {}),
    });
  }
  if (decision.behavior === 'deny') {
    const reason = typeof decision.message === 'string' ? decision.message.trim() : '';
    return hookOutput({
      behavior: 'deny',
      message: reason === '' ? 'Recusado pelo usuário no AI Office.' : `Recusado pelo usuário no AI Office: ${reason}`,
      interrupt: decision.interrupt === true,
    });
  }
  return null;
}

/** @param {Record<string, unknown>} decision */
const hookOutput = (decision) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });

/**
 * Long-polls the server until the request is decided. Returns the decision, or `null` when it expired, was
 * cancelled, the deadline passed or the server became unreachable.
 * @param {import('./lib.mjs').HookContext} ctx
 * @param {string} id
 * @param {number} deadline  Epoch milliseconds.
 * @param {() => number} [now]
 * @returns {Promise<Record<string, any> | null>}
 */
export async function waitForDecision(ctx, id, deadline, now = Date.now) {
  let failures = 0;
  while (now() < deadline) {
    const seconds = Math.max(1, Math.min(LONG_POLL_STEP_SECONDS, Math.ceil((deadline - now()) / 1000)));
    const response = await requestJson(
      ctx,
      'GET',
      `/api/permissions/${encodeURIComponent(id)}/wait?timeout=${seconds}`,
      {
        timeoutMs: seconds * 1000 + LONG_POLL_GRACE_MS,
      },
    );
    const status = response?.ok ? response.json?.status : undefined;
    if (status === 'decided') return response?.json;
    if (status === 'pending') {
      failures = 0;
      continue;
    }
    if (status === 'expired' || status === 'cancelled') return null;
    failures += 1;
    ctx.debug('wait failed', failures, '/', MAX_POLL_FAILURES);
    if (failures >= MAX_POLL_FAILURES) return null;
    await sleep(POLL_RETRY_DELAY_MS);
  }
  return null;
}

/**
 * Hook handler.
 * @param {Record<string, any>} input
 * @param {import('./lib.mjs').HookContext} ctx
 * @param {() => number} [now]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function handlePermissionRequest(input, ctx, now = Date.now) {
  if (typeof input.session_id !== 'string' || typeof input.tool_name !== 'string') {
    ctx.debug('input without session_id/tool_name');
    return null;
  }
  if (SKIPPED_TOOLS.has(input.tool_name)) {
    ctx.debug('skipping', input.tool_name);
    return null;
  }
  const timeoutMs = resolveTimeoutMs(ctx.env);
  const deadline = now() + timeoutMs;
  const body = buildPermissionBody(input, timeoutMs);
  if (body === null) {
    ctx.debug('request body too large even after trimming');
    return null;
  }
  const created = await requestJson(ctx, 'POST', '/api/permissions', { body });
  const id = created?.ok ? created.json?.id : undefined;
  if (typeof id !== 'string' || id === '') {
    ctx.debug('office did not take the request:', created?.json?.skip ?? 'unavailable');
    return null;
  }
  const decision = await waitForDecision(ctx, id, deadline, now);
  if (decision === null) return null;
  return buildDecisionOutput(
    decision,
    Array.isArray(input.permission_suggestions) ? input.permission_suggestions : undefined,
  );
}

if (isEntryPoint(import.meta.url)) {
  await runHook({
    scope: 'permission',
    budgetMs: resolveTimeoutMs(process.env) + LONG_POLL_GRACE_MS,
    handler: handlePermissionRequest,
  });
}
