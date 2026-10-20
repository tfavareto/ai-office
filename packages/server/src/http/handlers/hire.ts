// Hiring an agent from the office (local access only): open a terminal running Claude Code, and check a folder first.
import { API, type HireResponse } from '@ai-office/shared';
import { HIRE_CHECK_LIMIT, HIRE_CHECK_WINDOW_MS } from '../../hire/limits';
import { RateLimiter } from '../../util/rate-limit';
import type { AppContext } from '../context';
import { readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';
import { parseHireRequest } from '../validate';

export function registerHireRoutes(router: Router, app: AppContext): void {
  const checkLimiter = new RateLimiter(HIRE_CHECK_LIMIT, HIRE_CHECK_WINDOW_MS, app.now);

  router.add('POST', API.hire, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const hire = await app.hires.hire(parseHireRequest(await readJsonBody(req)));
    sendJson(res, 202, { hire } satisfies HireResponse);
  });

  router.add('GET', API.hireCheck, async ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const path = url.searchParams.get('path');
    if (path === null || path.length === 0 || path.length > 2000) return sendError(res, 400, 'invalid-projectPath');
    if (!checkLimiter.tryAcquire()) return sendError(res, 429, 'rate-limited');
    sendJson(res, 200, await app.hires.check(path));
  });
}
