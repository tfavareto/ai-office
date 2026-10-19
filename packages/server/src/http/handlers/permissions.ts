// Permission routes: the hook creates and long-polls, the page reads details and decides (local access only).
import { API, type PermissionRequest, permissionDraft } from '@ai-office/shared';
import { MAX_WAIT_MS } from '../../registries/permissions';
import type { AppContext } from '../context';
import { HttpError, closeSignal, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';
import { parseDecision, parsePermissionHookRequest, parseTimeoutMs } from '../validate';

export function registerPermissionRoutes(router: Router, app: AppContext): void {
  const base = API.permissions;

  router.add('POST', base, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const hook = parsePermissionHookRequest(await readJsonBody(req));
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
