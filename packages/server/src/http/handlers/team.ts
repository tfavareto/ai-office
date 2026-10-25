// Team mode management (local access only). The page uses these to host or join a team, see the pairing code and the
// members, and choose what it shares. None of this is reachable through the team listener, which has no HTTP at all.
import { API, parseSharePrefs, type TeamErrorCode } from '@ai-office/shared';
import { TeamActionError } from '../../team/service';
import { asRecord } from '../../util/fs-safe';
import type { AppContext } from '../context';
import { HttpError, readJsonBody, sendError, sendJson } from '../respond';
import type { Router } from '../router';

const STATUS_OF: Partial<Record<TeamErrorCode, number>> = {
  'invalid-address': 400,
  'invalid-port': 400,
  'invalid-name': 400,
  'invalid-code': 400,
  'invalid-body': 400,
  'unknown-member': 404,
  'pairing-failed': 403,
  'rate-limited': 429,
  unreachable: 502,
  timeout: 504,
  'save-failed': 500,
  'listen-failed': 500,
  'shared-address': 409,
};

function fail(res: Parameters<typeof sendError>[0], code: TeamErrorCode): void {
  sendError(res, STATUS_OF[code] ?? 409, code);
}

export function registerTeamRoutes(router: Router, app: AppContext): void {
  const write =
    (action: (body: Record<string, unknown>) => Promise<void>, needsBody = true) =>
    async ({ req, res, local }: Parameters<Parameters<Router['add']>[2]>[0]): Promise<void> => {
      if (!local) return sendError(res, 403, 'local-only');
      try {
        const body = needsBody ? asRecord(await readJsonBody(req)) : {};
        await action(body);
        app.snapshots.markDirty();
        sendJson(res, 200, app.team.status());
      } catch (error) {
        if (error instanceof TeamActionError) return fail(res, error.code);
        if (error instanceof HttpError) return sendError(res, error.status, error.message);
        throw error;
      }
    };

  router.add('GET', API.team, ({ res, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    sendJson(res, 200, app.team.status());
  });

  router.add(
    'POST',
    `${API.team}/host/start`,
    write(async (body) => {
      await app.team.startHosting({
        address: body.address as string,
        name: body.name as string,
        ...(typeof body.port === 'number' ? { port: body.port } : {}),
        ...(typeof body.teamName === 'string' ? { teamName: body.teamName } : {}),
        ...(typeof body.device === 'string' ? { device: body.device } : {}),
        ...(body.allowShared === true ? { allowShared: true } : {}),
      });
    }),
  );
  router.add(
    'POST',
    `${API.team}/host/stop`,
    write(() => app.team.stopHosting(), false),
  );
  router.add(
    'POST',
    `${API.team}/host/code`,
    write(async () => void (await app.team.newCode()), false),
  );
  router.add(
    'POST',
    `${API.team}/host/revoke`,
    write((body) => app.team.revoke(body.id as string)),
  );
  router.add(
    'POST',
    `${API.team}/host/end`,
    write(() => app.team.endTeam(), false),
  );
  router.add(
    'POST',
    `${API.team}/join`,
    write((body) =>
      app.team.join({
        address: body.address as string,
        code: body.code as string,
        name: body.name as string,
        ...(typeof body.port === 'number' ? { port: body.port } : {}),
        ...(typeof body.device === 'string' ? { device: body.device } : {}),
      }),
    ),
  );
  router.add(
    'POST',
    `${API.team}/leave`,
    write(() => app.team.leave(), false),
  );
  router.add(
    'POST',
    `${API.team}/sharing`,
    write(async (body) => void (await app.team.setSharing(parseSharePrefs(body)))),
  );
}
