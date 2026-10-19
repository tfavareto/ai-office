// health, stream, history, day and demo routes.
import { API, type HealthResponse } from '@ai-office/shared';
import { asRecord } from '../../util/fs-safe';
import { localDateString } from '../../util/ids';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

const HISTORY_LIMIT = 300;

export function registerSystemRoutes(router: Router, app: AppContext): void {
  router.add('GET', API.health, ({ res, local }) => {
    const counts = app.engine.sessionCounts();
    const body: HealthResponse = {
      ok: true,
      version: app.version,
      local,
      demo: app.isDemo(),
      accounts: app.engine.accountList().map((account) => ({ id: account.id, dir: account.dir, sessions: counts.get(account.id) ?? 0 })),
    };
    sendJson(res, 200, body);
  });

  router.add('GET', API.stream, ({ req, res, local }) => {
    app.hub.connect(req, res, local);
  });

  router.add('GET', API.history, ({ res, url }) => {
    const agentId = url.searchParams.get('agent');
    if (agentId === null) return sendError(res, 400, 'invalid-agent');
    const history = app.office.history(agentId);
    if (history === undefined) return sendError(res, 404, 'agent-not-found');
    sendJson(res, 200, { activities: history.slice(-HISTORY_LIMIT) });
  });

  router.add('GET', API.day, async ({ res, url }) => {
    const date = url.searchParams.get('date') ?? localDateString(app.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendError(res, 400, 'invalid-date');
    sendJson(res, 200, await app.day.get(date));
  });

  router.add('GET', API.demo, ({ res }) => sendJson(res, 200, { demo: app.isDemo() }));

  router.add('POST', API.demo, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const on = asRecord(await readJsonBody(req)).on;
    if (typeof on !== 'boolean') throw new HttpError(400, 'invalid-on');
    app.setDemo(on);
    sendJson(res, 200, { demo: app.isDemo() });
  });
}
