// Routines (local access only): prompts that run on a schedule, in a folder that is a room of the office.
import { API } from '@ai-office/shared';
import { RoutineLimitError, parseRoutineInput } from '../../routines/service';
import { asRecord } from '../../util/fs-safe';
import { RateLimiter } from '../../util/rate-limit';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

const BODY_LIMIT = 32 * 1024;
const RUNS_PER_MINUTE = 6;
const MINUTE_MS = 60_000;

export function registerRoutineRoutes(router: Router, app: AppContext): void {
  const base = API.routines;
  const runLimiter = new RateLimiter(RUNS_PER_MINUTE, MINUTE_MS, app.now);

  router.add('GET', base, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    // Demonstrations and their screenshots never show the person's own routines.
    sendJson(res, 200, { routines: app.isDemo() ? [] : app.routines.list() });
  });

  router.add('POST', base, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (app.isDemo()) return sendError(res, 409, 'demo');
    const input = parseRoutineInput(await readJsonBody(req, BODY_LIMIT));
    if (input === null) throw new HttpError(400, 'invalid-routine');
    // Only a room of the office: the page cannot send an agent to a folder of its choice.
    if (!app.office.state().projects.some((project) => project.path === input.projectPath))
      return sendError(res, 404, 'unknown-project');
    try {
      sendJson(res, 201, { routine: app.routines.add(input) });
    } catch (error) {
      if (!(error instanceof RoutineLimitError)) throw error;
      sendError(res, 409, 'too-many-routines');
    }
  });

  router.add('POST', `${base}/:id/enabled`, async ({ req, res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (app.isDemo()) return sendError(res, 409, 'demo');
    const { enabled } = asRecord(await readJsonBody(req, BODY_LIMIT));
    if (typeof enabled !== 'boolean') throw new HttpError(400, 'invalid-enabled');
    if (!app.routines.setEnabled(params.id as string, enabled)) return sendError(res, 404, 'routine-not-found');
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', `${base}/:id/run`, async ({ res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (app.isDemo()) return sendError(res, 409, 'demo');
    if (!runLimiter.tryAcquire()) return sendError(res, 429, 'rate-limited');
    if (!(await app.routines.runNow(params.id as string))) return sendError(res, 404, 'routine-not-found');
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', `${base}/:id/remove`, ({ res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (app.isDemo()) return sendError(res, 409, 'demo');
    if (!app.routines.remove(params.id as string)) return sendError(res, 404, 'routine-not-found');
    sendJson(res, 200, { ok: true });
  });
}
