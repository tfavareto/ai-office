// Settings of the Codex integration (local access only): whether the office reads Codex sessions at all.
import { API, type CodexSettings } from '@ai-office/shared';
import { codexAccounts, codexDirs } from '../../codex/home';
import { asRecord } from '../../util/fs-safe';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

function current(app: AppContext): CodexSettings {
  const dirs = codexDirs({
    homeDir: app.config.homeDir,
    envDir: app.config.codexHomeEnv,
    extraDirs: app.config.codexDirs,
  });
  return {
    sessions: app.codexSettings.sessions,
    available: codexAccounts(dirs).length > 0,
    locked: app.codexSettings.locked,
  };
}

export function registerCodexRoutes(router: Router, app: AppContext): void {
  router.add('GET', API.codexSettings, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    sendJson(res, 200, current(app));
  });

  router.add('POST', API.codexSettings, async ({ req, res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const on = asRecord(await readJsonBody(req)).sessions;
    if (typeof on !== 'boolean') throw new HttpError(400, 'invalid-sessions');
    if (app.codexSettings.locked) return sendError(res, 409, 'codex-disabled');
    if (!(await app.codexSettings.setSessions(on))) return sendError(res, 500, 'save-failed');
    await app.codex.reload();
    app.snapshots.markDirty();
    sendJson(res, 200, current(app));
  });
}
