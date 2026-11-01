// Settings of the git integration (local access only). Turning pull requests on is what lets the server start the
// user's own `gh` CLI, so it is a deliberate, local, token-protected action.
import { API, DEMO_PROJECT_FILES, type GitSettings, type ProjectFiles } from '@ai-office/shared';
import { listProjectFiles } from '../../git/project-files';
import { RateLimiter } from '../../util/rate-limit';
import { asRecord } from '../../util/fs-safe';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

/** Lists at most this many projects' files per minute: each one starts `git`. */
const FILES_LIMIT = 60;
const FILES_WINDOW_MS = 60_000;

function current(app: AppContext): GitSettings {
  return { pullRequests: app.gitSettings.pullRequests, gh: app.git.ghStatus() };
}

export function registerGitRoutes(router: Router, app: AppContext): void {
  const filesLimiter = new RateLimiter(FILES_LIMIT, FILES_WINDOW_MS, app.now);

  router.add('GET', API.projectFiles, async ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const id = url.searchParams.get('project');
    if (id === null || id.length === 0) return sendError(res, 400, 'invalid-project');
    // Only a room of the office: the page can never point git at a folder of its choice.
    const project = app.office.state().projects.find((candidate) => candidate.id === id);
    if (project === undefined) return sendError(res, 404, 'unknown-project');
    if (!filesLimiter.tryAcquire()) return sendError(res, 429, 'rate-limited');
    const list: ProjectFiles = app.isDemo()
      ? { files: [...DEMO_PROJECT_FILES], truncated: false }
      : await listProjectFiles(app.runGit, project.path);
    sendJson(res, 200, list);
  });

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
