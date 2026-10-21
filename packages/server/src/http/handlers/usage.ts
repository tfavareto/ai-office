// Usage history route (local access only): GET /api/usage/detail?account=<id|all>&period=today|week|month.
import { API, isUsagePeriod } from '@ai-office/shared';
import { isSafeSegment } from '../../util/ids';
import { usageDetail } from '../../usage/detail';
import type { AppContext } from '../context';
import { sendError, sendJson } from '../respond';
import type { Router } from '../router';

const ALL_ACCOUNTS = 'all';

export function registerUsageRoutes(router: Router, app: AppContext): void {
  router.add('GET', API.usageDetail, ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const period = url.searchParams.get('period') ?? 'today';
    if (!isUsagePeriod(period)) return sendError(res, 400, 'invalid-period');
    const account = url.searchParams.get('account') ?? ALL_ACCOUNTS;
    if (account !== ALL_ACCOUNTS && !isSafeSegment(account)) return sendError(res, 400, 'invalid-account');
    const state = app.office.state();
    const known = state.accounts.map((candidate) => candidate.id);
    if (account !== ALL_ACCOUNTS && !known.includes(account)) return sendError(res, 404, 'account-not-found');
    const now = app.now();
    sendJson(
      res,
      200,
      usageDetail(app.usage, {
        accountIds: account === ALL_ACCOUNTS ? known : [account],
        label: account,
        period,
        now,
        agents: state.agents,
        ...(app.isDemo() && app.office.demoSimulator !== undefined ? { demoRows: app.office.demoSimulator.usageRows(now) } : {}),
      }),
    );
  });
}
