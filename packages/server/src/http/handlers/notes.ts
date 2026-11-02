// The note of a room (local access only): the person's routes, by room, and the ones agents use, by their own terminal.
import { API, NOTE_MAX_CHARS } from '@ai-office/shared';
import { cleanLine } from '../../notes/service';
import { asRecord } from '../../util/fs-safe';
import { RateLimiter } from '../../util/rate-limit';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

const BODY_LIMIT = NOTE_MAX_CHARS * 4 + 1024;
const AGENT_BODY_LIMIT = 16 * 1024;
const MAX_LINE_CHARS = 4000;
const LINES_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

export function registerNoteRoutes(router: Router, app: AppContext): void {
  const limiters = new Map<string, RateLimiter>();
  const isRoom = (id: string): boolean => app.office.state().projects.some((project) => project.id === id);
  /** The room a terminal works in: its agent's, or the room of its folder while the session has not opened. */
  const roomOf = (terminalId: string): { room: string | undefined; name: string } | undefined => {
    const info = app.terminals.list().find((terminal) => terminal.id === terminalId && terminal.exitCode === undefined);
    if (info === undefined) return undefined;
    const { agents, projects } = app.office.state();
    const agent = agents.find((candidate) => candidate.terminalId === terminalId);
    const room = agent?.projectId ?? projects.find((project) => project.path === info.cwd)?.id;
    return { room, name: agent?.name ?? 'Agent' };
  };

  router.add('GET', API.notes, ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const project = url.searchParams.get('project') ?? '';
    if (app.isDemo()) return sendJson(res, 200, { text: '', updatedAt: 0 });
    if (!isRoom(project)) return sendError(res, 404, 'unknown-project');
    sendJson(res, 200, app.notes.get(project));
  });

  router.add('POST', API.notes, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    if (app.isDemo()) return sendError(res, 409, 'demo');
    const { project, text, baseUpdatedAt } = asRecord(await readJsonBody(req, BODY_LIMIT));
    if (typeof project !== 'string' || typeof text !== 'string' || typeof baseUpdatedAt !== 'number')
      throw new HttpError(400, 'invalid-note');
    if (!isRoom(project)) return sendError(res, 404, 'unknown-project');
    const result = app.notes.replace(project, text, baseUpdatedAt);
    if (result === 'changed') return sendError(res, 409, 'note-changed');
    if (result === 'too-long') return sendError(res, 400, 'note-too-long');
    if (result === 'too-many') return sendError(res, 409, 'too-many-notes');
    sendJson(res, 200, app.notes.get(project));
  });

  router.add('GET', `${API.terminals}/:id/note`, ({ res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const found = roomOf(params.id as string);
    if (found === undefined) return sendError(res, 404, 'terminal-not-found');
    sendJson(res, 200, { text: found.room === undefined ? '' : app.notes.get(found.room).text });
  });

  router.add('POST', `${API.terminals}/:id/note`, async ({ req, res, params, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const found = roomOf(params.id as string);
    if (found === undefined) return sendError(res, 404, 'terminal-not-found');
    const { text } = asRecord(await readJsonBody(req, AGENT_BODY_LIMIT));
    if (typeof text !== 'string' || text.length > MAX_LINE_CHARS || cleanLine(text) === '')
      throw new HttpError(400, 'invalid-note');
    if (found.room === undefined) return sendError(res, 409, 'no-room-yet');
    const id = params.id as string;
    const limiter = limiters.get(id) ?? new RateLimiter(LINES_PER_MINUTE, MINUTE_MS, app.now);
    limiters.set(id, limiter);
    if (!limiter.tryAcquire()) return sendError(res, 429, 'rate-limited');
    if (!app.notes.append(found.room, found.name, text)) return sendError(res, 409, 'note-full');
    sendJson(res, 200, { ok: true });
  });
}
