// Squads (local access only): real terminals started together in a project and connected to each other.
import { API } from '@ai-office/shared';
import type { AppContext } from '../context';
import { readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';
import { parseSquadRequest } from '../validate';

const BODY_LIMIT = 128 * 1024;

export function registerSquadRoutes(router: Router, app: AppContext): void {
  router.add('POST', API.squads, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (app.isDemo()) return sendError(res, 409, 'demo');
    const count = await app.hires.hireSquad(parseSquadRequest(await readJsonBody(req, BODY_LIMIT)));
    app.snapshots.markDirty();
    sendJson(res, 202, { count });
  });
}
