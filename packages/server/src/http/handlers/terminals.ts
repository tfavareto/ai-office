// Real terminals (local access only): what the page reads and what it types. There is no route that starts a program
// with a command of the page's choice: a terminal only starts from a hire, which builds its own command line.
import { API, type Agent, type TerminalSettings } from '@ai-office/shared';
import { formatDelivery } from '../../terminal/links';
import { RateLimiter } from '../../util/rate-limit';
import { asRecord } from '../../util/fs-safe';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

/** One request of typing or pasting; a larger paste is sent in pieces by the page. */
const MAX_INPUT_BYTES = 64 * 1024;
const INPUT_BODY_LIMIT = MAX_INPUT_BYTES * 2;
const SMALL_BODY_LIMIT = 1024;
/** One message from an agent to another. */
const MAX_MESSAGE_CHARS = 8000;
const MESSAGE_BODY_LIMIT = MAX_MESSAGE_CHARS * 4;
/** Two agents answering each other must not run away with the person's plan. */
const MESSAGES_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

function current(app: AppContext): TerminalSettings {
  return { enabled: app.terminalSettings.enabled, available: app.terminals.available };
}

export function registerTerminalRoutes(router: Router, app: AppContext): void {
  const base = API.terminals;
  const messageLimiters = new Map<string, RateLimiter>();
  const resuming = new Set<string>();
  const agentOf = (terminalId: string): Agent | undefined =>
    app.office.state().agents.find((agent) => agent.terminalId === terminalId);

  router.add('GET', API.terminalResumable, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    // With terminals off there is nothing to offer, but the list stays for when they are on again.
    const sessions = app.terminalSettings.enabled ? app.resumable() : [];
    sendJson(res, 200, {
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd,
        ...(session.role !== undefined ? { role: session.role } : {}),
      })),
    });
  });

  router.add('POST', `${API.terminalResumable}/resume`, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const { sessionId } = asRecord(await readJsonBody(req, SMALL_BODY_LIMIT));
    // Only what is on the list: the page cannot resume a session of its choice.
    const session = app.resumable().find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) return sendError(res, 404, 'unknown-session');
    // A double click must not run one conversation in two terminals.
    if (resuming.has(session.sessionId)) return sendError(res, 409, 'already-resuming');
    resuming.add(session.sessionId);
    try {
      await app.hires.resume(session);
      app.dismissResumable(session.sessionId);
    } finally {
      resuming.delete(session.sessionId);
    }
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', `${API.terminalResumable}/dismiss`, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    app.dismissResumable(undefined);
    sendJson(res, 200, { ok: true });
  });

  router.add('POST', API.terminalLinks, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (!app.terminalSettings.enabled) return sendError(res, 409, 'terminals-off');
    const { a, b, connected } = asRecord(await readJsonBody(req, SMALL_BODY_LIMIT));
    if (typeof a !== 'string' || typeof b !== 'string' || typeof connected !== 'boolean')
      throw new HttpError(400, 'invalid-link');
    if (!connected) app.terminals.disconnect(a, b);
    else if (!app.terminals.connect(a, b)) return sendError(res, 404, 'terminal-not-found');
    app.snapshots.markDirty();
    sendJson(res, 200, { ok: true });
  });

  router.add('GET', `${base}/:id/peers`, ({ res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const peers = app.terminals.peersOf(params.id as string).flatMap((id) => {
      const agent = agentOf(id);
      return agent === undefined
        ? []
        : [{ name: agent.name, status: agent.status, ...(agent.assignedRole ? { role: agent.assignedRole } : {}) }];
    });
    sendJson(res, 200, { peers });
  });

  router.add('POST', `${base}/:id/send`, async ({ req, res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (!app.terminalSettings.enabled) return sendError(res, 409, 'terminals-off');
    const from = params.id as string;
    const { to, text } = asRecord(await readJsonBody(req, MESSAGE_BODY_LIMIT));
    if (typeof to !== 'string' || typeof text !== 'string' || text.length === 0 || text.length > MAX_MESSAGE_CHARS)
      throw new HttpError(400, 'invalid-message');
    const wanted = to.trim().toLowerCase();
    const peer = app.terminals.peersOf(from).find((id) => agentOf(id)?.name.toLowerCase() === wanted);
    if (peer === undefined) return sendError(res, 404, 'unknown-peer');
    let limiter = messageLimiters.get(from);
    if (limiter === undefined) {
      limiter = new RateLimiter(MESSAGES_PER_MINUTE, MINUTE_MS, app.now);
      messageLimiters.set(from, limiter);
    }
    if (!limiter.tryAcquire()) return sendError(res, 429, 'rate-limited');
    const delivered = app.terminals.deliver(from, peer, formatDelivery(agentOf(from)?.name ?? from, text));
    if (!delivered) return sendError(res, 404, 'unknown-peer');
    sendJson(res, 200, { ok: true });
  });

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
