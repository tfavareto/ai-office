// Message routes (page: send + history; hooks: inbox + long-poll) and the Notification hook endpoint.
import { API, type BossMessage, type InboxResponse } from '@ai-office/shared';
import { MAX_MESSAGE_LENGTH, MAX_TEAM_SIZE, MAX_WAIT_MS } from '../../registries/messages';
import type { AppContext } from '../context';
import { closeSignal, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';
import { parseAttention, parseSendMessage, parseTimeoutMs } from '../validate';

export function registerMessageRoutes(router: Router, app: AppContext): void {
  const base = API.messages;

  router.add('POST', base, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const { agents, text } = parseSendMessage(await readJsonBody(req), MAX_TEAM_SIZE, MAX_MESSAGE_LENGTH);
    const demoIds = new Set((app.office.demoSimulator?.agents() ?? []).map((agent) => agent.id));
    const known = new Set(app.office.state().agents.map((agent) => agent.id));
    const realTargets = agents.filter((id) => known.has(id) && !demoIds.has(id));
    const demoTargets = agents.filter((id) => demoIds.has(id));
    if (realTargets.length === 0 && demoTargets.length === 0) return sendError(res, 404, 'no-agents');
    const messages: BossMessage[] = [
      ...(realTargets.length > 0 ? app.messages.send(realTargets, text) : []),
      ...(demoTargets.length > 0 ? (app.office.demoSimulator?.sendMessage(demoTargets, text, app.now()) ?? []) : []),
    ];
    sendJson(res, 201, { messages });
  });

  router.add('GET', base, ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const agentId = url.searchParams.get('agent');
    if (agentId === null) return sendError(res, 400, 'invalid-agent');
    const demo = app.office.demoSimulator;
    const messages = demo?.agents().some((agent) => agent.id === agentId) === true ? demo.messages(agentId) : app.messages.list(agentId);
    sendJson(res, 200, { messages });
  });

  router.add('GET', `${base}/inbox`, ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const agent = app.office.findAgent(url.searchParams.get('session') ?? '', url.searchParams.get('agent') ?? undefined);
    if (agent === undefined) return sendJson(res, 200, { skip: 'unknown-session' } satisfies InboxResponse);
    const via = url.searchParams.get('via') === 'stop' ? 'stop' : 'tool';
    sendJson(res, 200, { messages: app.messages.take(agent.id, via) } satisfies InboxResponse);
  });

  router.add('GET', `${base}/wait`, async ({ req, res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const agent = app.office.findAgent(url.searchParams.get('session') ?? '', url.searchParams.get('agent') ?? undefined);
    if (agent === undefined) return sendJson(res, 200, { skip: 'unknown-session' } satisfies InboxResponse);
    if (app.hub.localViewers() === 0) return sendJson(res, 200, { skip: 'no-viewer' } satisfies InboxResponse);
    const timeout = parseTimeoutMs(url.searchParams.get('timeout'), MAX_WAIT_MS / 1000, 25);
    const messages = await app.messages.wait(agent.id, timeout, closeSignal(req, res));
    sendJson(res, 200, { messages } satisfies InboxResponse);
  });

  router.add('POST', API.attention, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const input = parseAttention(await readJsonBody(req));
    const agent = app.office.findAgent(input.sessionId, input.agentId);
    if (agent === undefined) return sendJson(res, 200, { skip: 'unknown-session' });
    const marked = app.attention.mark(agent.id, { ...(input.message !== undefined ? { message: input.message } : {}), ...(input.type !== undefined ? { notificationType: input.type } : {}) });
    sendJson(res, 200, marked ? { ok: true } : { skip: 'idle-prompt' });
  });
}
