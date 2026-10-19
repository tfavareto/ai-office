// Message delivery hook: hands the user's messages from the AI Office web app to the agent that should read them.
// One script serves three Claude Code events and dispatches on `hook_event_name`:
//
//   PostToolUse   While the agent is working. GET /api/messages/inbox?via=tool returns queued messages, which are
//                 injected as `additionalContext` of the hook output ("Entregue durante o trabalho").
//   Stop          The agent is about to finish its turn. Queued messages (inbox via=stop) are delivered by blocking
//                 the stop with the text as the reason, so the agent continues with it as a new instruction. When
//                 nothing is queued the hook goes on standby ("de plantão"): it long-polls GET /api/messages/wait
//                 (25 s steps) for up to AI_OFFICE_STANDBY_MIN minutes (default 10, max 10, 0 disables), ending
//                 early when the server answers `{ skip }` (for instance because no page is open).
//   SubagentStop  Same as Stop without standby, and only for real subagents (the input must carry `agent_id`).
//
// Several queued messages are delivered as a numbered list. Environment: AI_OFFICE_PORT (default 4848),
// AI_OFFICE_STANDBY_MIN, AI_OFFICE_HOOK_DEBUG=1. The script never fails a session: every problem ends in exit code 0
// with empty stdout.

import {
  LONG_POLL_GRACE_MS,
  LONG_POLL_STEP_SECONDS,
  MAX_POLL_FAILURES,
  POLL_RETRY_DELAY_MS,
  isEntryPoint,
  queryString,
  readNumber,
  requestJson,
  runHook,
  sleep,
} from './lib.mjs';

export const DEFAULT_STANDBY_MINUTES = 10;
const MAX_STANDBY_MINUTES = 10;

/**
 * Longest the Stop hook may keep an agent on standby, in milliseconds (0 = disabled).
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
export function resolveStandbyMs(env) {
  const minutes = readNumber(env.AI_OFFICE_STANDBY_MIN, {
    fallback: DEFAULT_STANDBY_MINUTES,
    min: 0,
    max: MAX_STANDBY_MINUTES,
  });
  return Math.round(minutes * 60_000);
}

/**
 * Renders messages as plain text: the bare text for one message, a numbered list for several.
 * @param {string[]} texts
 * @returns {string}
 */
export function formatMessages(texts) {
  if (texts.length === 1) return texts[0];
  return texts.map((text, index) => `${index + 1}. ${text}`).join('\n');
}

/**
 * PostToolUse output: the messages ride along as additional context of the tool result.
 * @param {string[]} texts
 * @returns {Record<string, unknown>}
 */
export function buildToolOutput(texts) {
  const header =
    texts.length === 1
      ? 'Mensagem do usuário (seu chefe) enviada agora pelo AI Office, enquanto você trabalhava. Leve-a em conta e ajuste o rumo se necessário:'
      : 'Mensagens do usuário (seu chefe) enviadas agora pelo AI Office, enquanto você trabalhava. Leve-as em conta e ajuste o rumo se necessário:';
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `${header}\n\n${formatMessages(texts)}`,
    },
  };
}

/**
 * Stop / SubagentStop output: block the stop so the agent keeps going with the message as its next instruction.
 * @param {string[]} texts
 * @returns {Record<string, unknown>}
 */
export function buildStopOutput(texts) {
  const header =
    texts.length === 1
      ? 'Nova mensagem do usuário (seu chefe) pelo AI Office. Trate-a como uma nova instrução e responda a ela antes de encerrar:'
      : 'Novas mensagens do usuário (seu chefe) pelo AI Office. Trate-as como novas instruções e responda a elas antes de encerrar:';
  return { decision: 'block', reason: `${header}\n\n${formatMessages(texts)}` };
}

/**
 * Extracts the message texts of an inbox/wait response.
 * @param {import('./lib.mjs').HttpResult | null} response
 * @returns {{ texts: string[], skip: boolean, failed: boolean }}
 *   `skip`: the server told us to stop asking; `failed`: no usable answer.
 */
export function readInbox(response) {
  const json = response?.ok ? response.json : null;
  if (json === null || typeof json !== 'object') return { texts: [], skip: false, failed: true };
  if (typeof json.skip === 'string') return { texts: [], skip: true, failed: false };
  if (!Array.isArray(json.messages)) return { texts: [], skip: false, failed: true };
  const texts = json.messages
    .map((/** @type {any} */ message) => message?.text)
    .filter((/** @type {unknown} */ text) => typeof text === 'string' && text.trim() !== '');
  return { texts, skip: false, failed: false };
}

/**
 * @param {import('./lib.mjs').HookContext} ctx
 * @param {{ session: string, agent?: string, via: 'tool' | 'stop' }} target
 */
function fetchInbox(ctx, { session, agent, via }) {
  return requestJson(ctx, 'GET', `/api/messages/inbox${queryString({ session, agent, via })}`).then(readInbox);
}

/**
 * Standby ("de plantão"): long-polls for a message until one arrives, the server says skip, the deadline passes or
 * the server becomes unreachable.
 * @param {import('./lib.mjs').HookContext} ctx
 * @param {{ session: string, agent?: string }} target
 * @param {number} totalMs
 * @param {() => number} [now]
 * @returns {Promise<string[]>}  Message texts, empty when none arrived.
 */
export async function standby(ctx, { session, agent }, totalMs, now = Date.now) {
  const deadline = now() + totalMs;
  let failures = 0;
  while (now() < deadline) {
    const seconds = Math.max(1, Math.min(LONG_POLL_STEP_SECONDS, Math.ceil((deadline - now()) / 1000)));
    const response = await requestJson(
      ctx,
      'GET',
      `/api/messages/wait${queryString({ session, agent, timeout: seconds })}`,
      { timeoutMs: seconds * 1000 + LONG_POLL_GRACE_MS },
    );
    const result = readInbox(response);
    if (result.texts.length > 0) return result.texts;
    if (result.skip) {
      ctx.debug('standby ended: server said skip');
      return [];
    }
    if (result.failed) {
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) return [];
      await sleep(POLL_RETRY_DELAY_MS);
    } else {
      failures = 0;
    }
  }
  return [];
}

/**
 * Hook handler.
 * @param {Record<string, any>} input
 * @param {import('./lib.mjs').HookContext} ctx
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function handleMessageHook(input, ctx) {
  const session = input.session_id;
  if (typeof session !== 'string' || session === '') {
    ctx.debug('input without session_id');
    return null;
  }
  const agent = typeof input.agent_id === 'string' && input.agent_id !== '' ? input.agent_id : undefined;

  switch (input.hook_event_name) {
    case 'PostToolUse': {
      const inbox = await fetchInbox(ctx, { session, agent, via: 'tool' });
      return inbox.texts.length > 0 ? buildToolOutput(inbox.texts) : null;
    }
    case 'SubagentStop': {
      if (agent === undefined) {
        ctx.debug('SubagentStop without agent_id, ignoring');
        return null;
      }
      const inbox = await fetchInbox(ctx, { session, agent, via: 'stop' });
      return inbox.texts.length > 0 ? buildStopOutput(inbox.texts) : null;
    }
    case 'Stop': {
      const inbox = await fetchInbox(ctx, { session, agent, via: 'stop' });
      if (inbox.texts.length > 0) return buildStopOutput(inbox.texts);
      const standbyMs = resolveStandbyMs(ctx.env);
      if (inbox.skip || inbox.failed || standbyMs === 0) return null;
      const texts = await standby(ctx, { session, agent }, standbyMs);
      return texts.length > 0 ? buildStopOutput(texts) : null;
    }
    default:
      ctx.debug('ignoring event', input.hook_event_name);
      return null;
  }
}

if (isEntryPoint(import.meta.url)) {
  await runHook({
    scope: 'messages',
    budgetMs: resolveStandbyMs(process.env) + LONG_POLL_GRACE_MS,
    handler: handleMessageHook,
  });
}
