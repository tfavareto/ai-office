// Real terminals (local access only): what the page reads and what it types. There is no route that starts a program
// with a command of the page's choice: a terminal only starts from a hire, which builds its own command line.
import { API, type TerminalSettings } from '@ai-office/shared';
import { asRecord } from '../../util/fs-safe';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

/** One request of typing or pasting; a larger paste is sent in pieces by the page. */
const MAX_INPUT_BYTES = 64 * 1024;
const INPUT_BODY_LIMIT = MAX_INPUT_BYTES * 2;
const SMALL_BODY_LIMIT = 1024;

function current(app: AppContext): TerminalSettings {
  return { enabled: app.terminalSettings.enabled, available: app.terminals.available };
}

export function registerTerminalRoutes(router: Router, app: AppContext): void {
  const base = API.terminals;

  router.add('GET', API.terminalSettings, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    sendJson(res, 200, current(app));
  });

  router.add('POST', API.terminalSettings, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const on = asRecord(await readJsonBody(req, SMALL_BODY_LIMIT)).enabled;
    if (typeof on !== 'boolean') throw new HttpError(400, 'invalid-enabled');
    if (!(await app.terminalSettings.setEnabled(on))) return sendError(res, 500, 'save-failed');
    // Off means off: nothing keeps running that the page could still type into.
    if (!on) await app.terminals.stopAll();
    sendJson(res, 200, current(app));
  });

  router.add('GET', API.terminalStream, ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (!app.terminalSettings.enabled) return sendError(res, 409, 'terminals-off');
    if (app.terminalStreams.isFull()) {
      res.setHeader('Retry-After', '5');
      return sendError(res, 503, 'too-many-streams');
    }
    app.terminalStreams.connect(req, res);
  });

  router.add('POST', `${base}/:id/input`, async ({ req, res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (!app.terminalSettings.enabled) return sendError(res, 409, 'terminals-off');
    const data = asRecord(await readJsonBody(req, INPUT_BODY_LIMIT)).data;
    if (typeof data !== 'string' || data.length === 0 || Buffer.byteLength(data) > MAX_INPUT_BYTES)
      throw new HttpError(400, 'invalid-data');
    if (!app.terminals.write(params.id as string, data)) return sendError(res, 404, 'terminal-not-found');
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', `${base}/:id/resize`, async ({ req, res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (!app.terminalSettings.enabled) return sendError(res, 409, 'terminals-off');
    const { cols, rows } = asRecord(await readJsonBody(req, SMALL_BODY_LIMIT));
    if (typeof cols !== 'number' || typeof rows !== 'number' || !Number.isFinite(cols) || !Number.isFinite(rows))
      throw new HttpError(400, 'invalid-size');
    if (!app.terminals.resize(params.id as string, cols, rows)) return sendError(res, 404, 'terminal-not-found');
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', `${base}/:id/kill`, ({ res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (!app.terminals.kill(params.id as string)) return sendError(res, 404, 'terminal-not-found');
    sendJson(res, 200, { ok: true });
  });
}
