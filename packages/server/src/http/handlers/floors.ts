// Floors (local access only): a checkout per task, landed or removed only when the person asks. Every route starts from
// a room of the office, so the page can never point git at a folder of its choice.
import { API } from '@ai-office/shared';
import {
  FloorError,
  createFloor,
  floorStatus,
  landFloorByMerge,
  landFloorByPullRequest,
  removeFloor,
} from '../../git/floors';
import { asRecord } from '../../util/fs-safe';
import { RateLimiter } from '../../util/rate-limit';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

const BODY_LIMIT = 8 * 1024;
const ACTIONS_PER_MINUTE = 20;
const MINUTE_MS = 60_000;

const STATUS_OF: Partial<Record<FloorError['code'], number>> = {
  'invalid-name': 400,
  'not-a-repository': 400,
  'not-a-floor': 400,
  'git-failed': 502,
};

export function registerFloorRoutes(router: Router, app: AppContext): void {
  const limiter = new RateLimiter(ACTIONS_PER_MINUTE, MINUTE_MS, app.now);

  const roomPath = (id: unknown): string => {
    if (typeof id !== 'string' || id.length === 0) throw new HttpError(400, 'invalid-project');
    const project = app.office.state().projects.find((candidate) => candidate.id === id);
    if (project === undefined) throw new HttpError(404, 'unknown-project');
    if (app.isDemo()) throw new HttpError(409, 'demo');
    return project.path;
  };

  const act = async <T>(res: Parameters<typeof sendJson>[0], action: () => Promise<T>): Promise<void> => {
    if (!limiter.tryAcquire()) return sendError(res, 429, 'rate-limited');
    try {
      sendJson(res, 200, await action());
    } catch (error) {
      if (!(error instanceof FloorError)) throw error;
      sendJson(res, STATUS_OF[error.code] ?? 409, { error: error.code, files: error.files });
    }
  };

  router.add('GET', `${API.floors}/status`, async ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const status = await floorStatus(app.runGit, roomPath(url.searchParams.get('project')));
    // Where the repository is on disk stays on the server: the page only needs what the floor is.
    if (!status.isFloor) return sendJson(res, 200, { isFloor: false });
    sendJson(res, 200, {
      isFloor: true,
      branch: status.branch,
      target: status.target,
      ahead: status.ahead,
      dirty: status.dirty,
      detached: status.detached,
    });
  });

  router.add('POST', API.floors, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const { project, name } = asRecord(await readJsonBody(req, BODY_LIMIT));
    if (typeof name !== 'string') throw new HttpError(400, 'invalid-name');
    const path = roomPath(project);
    await act(res, () => createFloor(app.runGit, path, name));
  });

  router.add('POST', `${API.floors}/land`, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const { project, mode } = asRecord(await readJsonBody(req, BODY_LIMIT));
    if (mode !== 'merge' && mode !== 'pull-request') throw new HttpError(400, 'invalid-mode');
    const path = roomPath(project);
    await act(res, async () => {
      if (mode === 'merge') {
        await landFloorByMerge(app.runGit, path);
        return { ok: true };
      }
      return { ok: true, url: await landFloorByPullRequest(app.runGit, app.runGh, path) };
    });
  });

  router.add('POST', `${API.floors}/remove`, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const { project, acceptIgnored } = asRecord(await readJsonBody(req, BODY_LIMIT));
    const path = roomPath(project);
    const busy = app.office
      .state()
      .agents.some((agent) => agent.projectId === project && agent.status !== 'offline' && agent.status !== 'done');
    if (busy) return sendError(res, 409, 'floor-busy');
    await act(res, () => removeFloor(app.runGit, path, { acceptIgnored: acceptIgnored === true }));
  });
}
