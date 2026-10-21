// Approval rule routes: list, create, edit, delete, preview and the auto-decision log (local access only).
import { API, type RuleBookError, type RuleErrorBody, type RuleLogResponse, type RuleResponse, type RulesResponse } from '@ai-office/shared';
import type { AppContext } from '../context';
import { readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';
import { parseLogLimit } from '../validate';

const STATUS_BY_CODE: Readonly<Record<string, number>> = { 'not-found': 404, 'duplicate-rule': 409, 'too-many-rules': 409 };

function sendRuleError(res: Parameters<typeof sendJson>[0], error: RuleBookError): void {
  const body: RuleErrorBody = { error: error.code, ...(error.field !== undefined ? { field: error.field } : {}), ...(error.detail !== undefined ? { detail: error.detail } : {}) };
  sendJson(res, STATUS_BY_CODE[error.code] ?? 400, body);
}

export function registerRuleRoutes(router: Router, app: AppContext): void {
  const base = API.rules;
  const book = app.rules.book;

  /** Applies a change and saves it; when the disk refuses, the change is undone and the page is told. */
  const persist = async (res: Parameters<typeof sendJson>[0], undoTo: ReturnType<typeof book.rules>): Promise<boolean> => {
    if (await app.rules.flush()) return true;
    book.replaceRules(undoTo);
    sendError(res, 500, 'save-failed');
    return false;
  };

  router.add('GET', base, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    sendJson(res, 200, { rules: [...book.rules()] } satisfies RulesResponse);
  });

  // Registered before `/:id`, so `log` and `preview` are never taken for rule ids.
  router.add('GET', `${base}/log`, ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    sendJson(res, 200, { entries: book.log(parseLogLimit(url.searchParams.get('limit'))) } satisfies RuleLogResponse);
  });

  router.add('DELETE', `${base}/log`, async ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    book.clearLog();
    await app.rules.flush();
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', `${base}/preview`, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const preview = book.preview(await readJsonBody(req));
    if (!preview.ok) return sendRuleError(res, preview.error);
    sendJson(res, 200, preview.value);
  });

  router.add('POST', base, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const before = book.rules();
    const created = book.create(await readJsonBody(req));
    if (!created.ok) return sendRuleError(res, created.error);
    if (!(await persist(res, before))) return;
    sendJson(res, 201, { rule: created.value } satisfies RuleResponse);
  });

  router.add('PATCH', `${base}/:id`, async ({ req, res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const before = book.rules();
    const updated = book.update(params.id as string, await readJsonBody(req));
    if (!updated.ok) return sendRuleError(res, updated.error);
    if (!(await persist(res, before))) return;
    sendJson(res, 200, { rule: updated.value } satisfies RuleResponse);
  });

  router.add('DELETE', `${base}/:id`, async ({ res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const before = book.rules();
    if (!book.remove(params.id as string)) return sendError(res, 404, 'not-found');
    if (!(await persist(res, before))) return;
    sendJson(res, 200, { ok: true });
  });
}
