// Notification hook: tells AI Office that an agent is waiting for the user (permission prompt, idle prompt...).
//
// Flow: Claude Code runs the hook with `{ session_id, message, agent_id? }`; the script POSTs
// `{ session_id, agent_id?, message }` to /api/attention and prints nothing. The office then marks the agent as
// "needs you" until its next transcript event. If AI Office is offline the script exits silently and quickly.
//
// Environment: AI_OFFICE_PORT (default 4848), AI_OFFICE_STATE_DIR (token location), AI_OFFICE_HOOK_DEBUG=1.

import { isEntryPoint, requestJson, runHook } from './lib.mjs';

const MAX_MESSAGE_CHARS = 1000;

/**
 * Builds the POST /api/attention body, or `null` when the input has no session.
 * @param {Record<string, any>} input
 * @returns {{ session_id: string, agent_id?: string, message?: string } | null}
 */
export function buildAttentionBody(input) {
  if (typeof input.session_id !== 'string' || input.session_id === '') return null;
  return {
    session_id: input.session_id,
    ...(typeof input.agent_id === 'string' && input.agent_id !== '' ? { agent_id: input.agent_id } : {}),
    ...(typeof input.message === 'string' && input.message !== ''
      ? { message: input.message.slice(0, MAX_MESSAGE_CHARS) }
      : {}),
  };
}

/**
 * Hook handler. Never produces output.
 * @param {Record<string, any>} input
 * @param {import('./lib.mjs').HookContext} ctx
 * @returns {Promise<null>}
 */
export async function handleNotification(input, ctx) {
  const body = buildAttentionBody(input);
  if (body === null) {
    ctx.debug('input without session_id');
    return null;
  }
  await requestJson(ctx, 'POST', '/api/attention', { body });
  return null;
}

if (isEntryPoint(import.meta.url)) {
  await runHook({ scope: 'notify', budgetMs: 5_000, handler: handleNotification });
}
