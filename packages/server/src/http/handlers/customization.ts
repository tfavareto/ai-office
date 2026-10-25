// Customization routes (local access only): read it, replace it, change a part of it (a JSON merge patch where `null`
// resets) or reset everything. Every body is validated by the shared reader; the answer is always the whole document.
import { API, type CustomizationResponse, MAX_CUSTOMIZATION_BYTES } from '@ai-office/shared';
import type { AppContext } from '../context';
import { readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';
import type { ChangeResult } from '../../customization/store';

function answer(res: Parameters<typeof sendJson>[0], result: ChangeResult): void {
  if (result.ok) {
    sendJson(res, 200, { customization: result.value } satisfies CustomizationResponse);
    return;
  }
  if (result.status === 500) sendError(res, 500, 'save-failed');
  else sendJson(res, 400, result.error);
}

export function registerCustomizationRoutes(router: Router, app: AppContext): void {
  const base = API.customization;
  const store = app.customization;

  router.add('GET', base, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    sendJson(res, 200, { customization: store.current } satisfies CustomizationResponse);
  });

  router.add('PUT', base, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    answer(res, await store.replace(await readJsonBody(req, MAX_CUSTOMIZATION_BYTES)));
  });

  router.add('PATCH', base, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    answer(res, await store.patch(await readJsonBody(req, MAX_CUSTOMIZATION_BYTES)));
  });

  router.add('DELETE', base, async ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    answer(res, await store.reset());
  });
}
