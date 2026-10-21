// Day report route (local access only): GET /api/report/day?date=&account=&requests=&locale=.
import { API, type DayReport, demoDayReport } from '@ai-office/shared';
import type { AppContext } from '../context';
import { sendError, sendJson } from '../respond';
import type { Router } from '../router';
import { parseReportQuery } from '../validate';

export function registerReportRoutes(router: Router, app: AppContext): void {
  router.add('GET', API.report, async ({ res, url, local }) => {
    if (!local) return sendError(res, 403, 'local-only');
    const now = app.now();
    const query = parseReportQuery(url.searchParams, now);
    const state = app.office.state();
    if (query.account !== 'all' && !state.accounts.some((account) => account.id === query.account))
      return sendError(res, 404, 'account-not-found');
    const accounts = app.engine
      .accountList()
      .filter((account) => query.account === 'all' || account.id === query.account);
    const real: DayReport =
      accounts.length > 0
        ? await app.report.report({
            range: query.range,
            accounts,
            label: query.account,
            includeRequests: query.includeRequests,
          })
        : {
            date: query.range.date,
            generatedAt: now,
            account: query.account,
            includeRequests: query.includeRequests,
            projects: [],
          };
    const simulator = app.isDemo() ? app.office.demoSimulator : undefined;
    if (simulator === undefined) return sendJson(res, 200, real);
    const demo = demoDayReport({
      range: query.range,
      now,
      locale: query.locale,
      agents: simulator.agents(),
      usageRows: simulator.usageRows(now),
      account: query.account,
      includeRequests: query.includeRequests,
    });
    sendJson(res, 200, { ...real, projects: [...real.projects, ...demo.projects], demo: true } satisfies DayReport);
  });
}
