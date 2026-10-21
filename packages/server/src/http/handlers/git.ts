// Settings of the git integration (local access only). Turning pull requests on is what lets the server start the
// user's own `gh` CLI, so it is a deliberate, local, token-protected action.
import { API, type GitSettings } from '@ai-office/shared';
import { asRecord } from '../../util/fs-safe';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

function current(app: AppContext): GitSettings {
  return { pullRequests: app.gitSettings.pullRequests, gh: app.git.ghStatus() };
}

export function registerGitRoutes(router: Router, app: AppContext): void {
  router.add('GET', API.gitSettings, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    sendJson(res, 200, current(app));
  });

  router.add('POST', API.gitSettings, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const on = asRecord(await readJsonBody(req)).pullRequests;
    if (typeof on !== 'boolean') throw new HttpError(400, 'invalid-pullRequests');
    if (!(await app.gitSettings.setPullRequests(on))) return sendError(res, 500, 'save-failed');
    app.git.tick();
    app.snapshots.markDirty();
    sendJson(res, 200, current(app));
  });
}
