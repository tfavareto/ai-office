// Progress routes (local access only): GET /api/progress[?project=1] and POST /api/progress/event.
import { API, PROGRESS_EVENTS, type ProgressEventName } from '@ai-office/shared';
import { asRecord } from '../../util/fs-safe';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

function isEvent(value: unknown): value is ProgressEventName {
  return typeof value === 'string' && (PROGRESS_EVENTS as readonly string[]).includes(value);
}

export function registerProgressRoutes(router: Router, app: AppContext): void {
  router.add('GET', API.progress, ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    app.progress.refreshIfStale();
    sendJson(res, 200, app.progressView(url.searchParams.get('project') === '1'));
  });

  router.add('POST', `${API.progress}/event`, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const event = asRecord(await readJsonBody(req)).event;
    if (!isEvent(event)) throw new HttpError(400, 'invalid-event');
    // The demo office is not the user's: nothing done there counts.
    if (!app.isDemo()) await app.progress.recordEvent(event);
    sendJson(res, 200, { ok: true });
  });
}
