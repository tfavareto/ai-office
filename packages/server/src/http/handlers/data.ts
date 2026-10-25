// Transcript and recent-sessions routes (local access only).
import { join } from 'node:path';
import { API, type RecentSession, type TranscriptPage, truncate } from '@ai-office/shared';
import { findTranscript, subagentsDir } from '../../claude/paths';
import { findRollout } from '../../codex/rollouts';
import { scanRecentSessions } from '../../claude/sessions-scan';
import { isSafeSegment } from '../../util/ids';
import type { AppContext } from '../context';
import { sendError, sendJson } from '../respond';
import type { Router } from '../router';

/** Subagent ids arrive either raw ("a123") or as office agent ids ("account:session:a123"). */
function rawAgentId(value: string): string {
  const colon = value.lastIndexOf(':');
  return colon < 0 ? value : value.slice(colon + 1);
}

export function registerDataRoutes(router: Router, app: AppContext): void {
  router.add('GET', API.transcript, async ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const sessionId = url.searchParams.get('session') ?? '';
    const accountId = url.searchParams.get('account') ?? '';
    const agentParam = url.searchParams.get('agent');
    const afterRaw = url.searchParams.get('after');
    const after = afterRaw === null ? undefined : Number(afterRaw);
    if (!isSafeSegment(sessionId) || (after !== undefined && (!Number.isInteger(after) || after < 0)))
      return sendError(res, 400, 'invalid-query');
    const account = app.sourceAccounts().find((candidate) => candidate.id === accountId);
    if (account === undefined) return sendError(res, 404, 'account-not-found');
    const record = app.office.record(`${account.id}:${sessionId}`);
    const codex = account.source === 'codex';
    const main = codex
      ? (app.codex.pathOf(account.id, sessionId) ?? (await findRollout(account.dir, sessionId)))
      : await findTranscript(account.dir, sessionId, record?.registry?.cwd);
    if (main === undefined) return sendError(res, 404, 'session-not-found');
    let path: string | undefined = main;
    if (agentParam !== null) {
      const agentId = rawAgentId(agentParam);
      if (!isSafeSegment(agentId)) return sendError(res, 400, 'invalid-agent');
      path = codex
        ? app.codex.pathOf(account.id, sessionId, agentId)
        : join(subagentsDir(main), `agent-${agentId}.jsonl`);
      if (path === undefined) return sendError(res, 404, 'transcript-not-found');
    }
    const view = await app.transcripts.open(path, codex ? 'codex' : undefined);
    if (view === undefined) return sendError(res, 404, 'transcript-not-found');
    const page = view.page(after);
    const first = page.entries.find((entry) => entry.kind === 'user');
    const title =
      record?.registry?.name ?? record?.main.title() ?? (first?.kind === 'user' ? truncate(first.text, 80) : undefined);
    const body: TranscriptPage = {
      entries: page.entries,
      next: page.next,
      ...(title !== undefined ? { title } : {}),
      open: record !== undefined && record.closedAt === undefined,
    };
    sendJson(res, 200, body);
  });

  router.add('GET', API.sessions, async ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const sessions: RecentSession[] = await scanRecentSessions(
      app.sourceAccounts(),
      app.now(),
      (accountId, sessionId) => {
        const record = app.office.record(`${accountId}:${sessionId}`);
        if (record === undefined || record.closedAt !== undefined) return undefined;
        return { agentId: record.key, ...(record.registry?.name !== undefined ? { title: record.registry.name } : {}) };
      },
    );
    sendJson(res, 200, { sessions });
  });
}
