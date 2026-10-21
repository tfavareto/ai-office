// Day time-lapse route (local access only): GET /api/timelapse?date=&account=&locale=.
import { API, type Timelapse, demoTimelapse, emptyTimelapse, mergeTimelapses } from '@ai-office/shared';
import type { AppContext } from '../context';
import { sendError, sendJson } from '../respond';
import type { Router } from '../router';
import { parseTimelapseQuery } from '../validate';

export function registerTimelapseRoutes(router: Router, app: AppContext): void {
  router.add('GET', API.timelapse, async ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const now = app.now();
    const query = parseTimelapseQuery(url.searchParams, now);
    const state = app.office.state();
    if (query.account !== 'all' && !state.accounts.some((account) => account.id === query.account))
      return sendError(res, 404, 'account-not-found');
    const accounts = app.engine
      .accountList()
      .filter((account) => query.account === 'all' || account.id === query.account);
    const real: Timelapse =
      accounts.length > 0
        ? await app.report.timelapse({ range: query.range, accounts, label: query.account })
        : emptyTimelapse({
            date: query.range.date,
            generatedAt: now,
            account: query.account,
            start: query.range.start,
            end: query.range.end,
          });
    const simulator = app.isDemo() ? app.office.demoSimulator : undefined;
    if (simulator === undefined) return sendJson(res, 200, real);
    const demo = demoTimelapse({
      range: query.range,
      now,
      locale: query.locale,
      agents: simulator.agents(),
      account: query.account,
    });
    sendJson(res, 200, mergeTimelapses(real, demo));
  });
}
