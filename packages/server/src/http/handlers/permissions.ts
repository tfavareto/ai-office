// Permission routes: the hook creates and long-polls, the page reads details and decides (local access only).
import { API, type PermissionHookRequest, type PermissionRequest, autoAnswer, permissionDraft, ruleDraft } from '@ai-office/shared';
import { MAX_WAIT_MS } from '../../registries/permissions';
import { describePermission } from '../../registries/permission-text';
import type { AppContext } from '../context';
import { HttpError, closeSignal, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';
import { parseDecision, parsePermissionHookRequest, parseTimeoutMs } from '../validate';

/** Lets the approval rules answer a hook request; the id of the already-answered request, or undefined. */
function answerWithRules(app: AppContext, hook: PermissionHookRequest): string | undefined {
  const agent = app.office.findAgent(hook.session_id, hook.agent_id);
  if (agent === undefined) return undefined;
  const answer = autoAnswer(app.rules.book, {
    toolName: hook.tool_name,
    input: hook.tool_input,
    summary: describePermission(hook.tool_name, hook.tool_input).summary,
    projectPath: agent.projectId,
    accountId: agent.accountId,
    agentId: agent.id,
    agentName: agent.name,
    ...(agent.demo === true ? { demo: true } : {}),
  });
  if (answer === undefined) return undefined;
  const id = app.permissions.createDecided(hook, agent.id, answer.decision);
  const { summary, summaryMsg } = describePermission(hook.tool_name, hook.tool_input);
  app.office.addExternalActivity(agent.id, ruleDraft(answer.effect, summary, summaryMsg));
  return id;
}

export function registerPermissionRoutes(router: Router, app: AppContext): void {
  const base = API.permissions;

  router.add('POST', base, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const hook = parsePermissionHookRequest(await readJsonBody(req));
    // Rules answer first, whether or not a page is open: a standing answer does not need a viewer.
    const answered = answerWithRules(app, hook);
    if (answered !== undefined) return sendJson(res, 201, { id: answered });
    if (app.hub.localViewers() === 0) return sendJson(res, 200, { skip: 'no-viewer' });
    const created = app.permissions.create(hook);
    if ('skip' in created) return sendJson(res, 200, created);
    const request = app.permissions.get(created.id);
    if (request !== undefined) app.office.addExternalActivity(request.agentId, permissionDraft(request.summary, request.summaryMsg));
    sendJson(res, 201, created);
  });

  router.add('GET', `${base}/:id/wait`, async ({ req, res, params, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const timeout = parseTimeoutMs(url.searchParams.get('timeout'), MAX_WAIT_MS / 1000, 25);
    sendJson(res, 200, await app.permissions.wait(params.id as string, timeout, closeSignal(req, res)));
  });

  router.add('GET', `${base}/:id`, ({ res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const id = params.id as string;
    const request: PermissionRequest | undefined = app.permissions.get(id) ?? app.office.state().agents.find((agent) => agent.permission?.id === id)?.permission;
    if (request === undefined) return sendError(res, 404, 'not-found');
    sendJson(res, 200, request);
  });

  router.add('POST', `${base}/:id/decision`, async ({ req, res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const id = params.id as string;
    const body = await readJsonBody(req);
    const suggestionCount = app.permissions.get(id)?.suggestions.length ?? app.office.state().agents.find((agent) => agent.permission?.id === id)?.permission?.suggestions.length ?? 0;
    const decision = parseDecision(body, suggestionCount);
    const result = app.permissions.decide(id, decision);
    if (result === 'ok') return sendJson(res, 200, { ok: true });
    if (result === 'conflict') return sendError(res, 409, 'already-answered');
    const demo = app.office.demoSimulator;
    if (demo?.decidePermission(id, decision) === true) {
      app.office.refresh(app.now());
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(404, 'not-found');
  });
}
