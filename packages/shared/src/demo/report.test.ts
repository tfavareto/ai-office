import { describe, expect, test } from 'vitest';
import { LOCALES } from '../i18n';
import { dayRange, reportDates } from '../report/range';
import { REPORT_BUCKETS } from '../report/types';
import { reportTotals } from '../report/totals';
import { createDemoSimulator } from './simulator';
import { demoDayReport } from './report';

const NOW = new Date(2026, 9, 21, 15, 30).getTime();
const agents = createDemoSimulator({ seed: 3, now: () => NOW }).agents();

function report(date: string, over: Partial<Parameters<typeof demoDayReport>[0]> = {}) {
  const range = dayRange(date);
  if (range === undefined) throw new Error('bad date');
  return demoDayReport({
    range,
    now: NOW,
    locale: 'pt-BR',
    agents,
    usageRows: [],
    account: 'all',
    includeRequests: false,
    ...over,
  });
}

describe('demoDayReport', () => {
  test('is deterministic for a date and a language', () => {
    expect(report('2026-10-20')).toEqual(report('2026-10-20'));
  });

  test('today has work from the people in the office, none of it after now', () => {
    const today = report('2026-10-21');
    const people = today.projects.flatMap((project) => project.agents);
    expect(today.demo).toBe(true);
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((agent) => agent.lastAt <= NOW && agent.activity.length === REPORT_BUCKETS)).toBe(true);
    expect(reportTotals(today).activeMs).toBeGreaterThan(0);
  });

  test('early in the morning today still has a little work, squeezed into the time there is', () => {
    const early = new Date(2026, 9, 21, 0, 40).getTime();
    const range = dayRange('2026-10-21');
    if (range === undefined) throw new Error('bad date');
    const today = demoDayReport({
      range,
      now: early,
      locale: 'en',
      agents,
      usageRows: [],
      account: 'all',
      includeRequests: false,
    });
    const people = today.projects.flatMap((project) => project.agents);
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((agent) => agent.lastAt <= early && agent.firstAt >= range.start)).toBe(true);
  });

  test('every day the picker offers has a believable report, and the days differ', () => {
    const days = reportDates(NOW).map((date) => report(date));
    expect(days.every((day) => day.projects.length > 0 || new Date(`${day.date}T12:00`).getDay() % 6 === 0)).toBe(true);
    expect(new Set(days.map((day) => JSON.stringify(reportTotals(day)))).size).toBeGreaterThan(3);
  });

  test('commit subjects and task titles follow the language', () => {
    const subjects = LOCALES.map((locale) =>
      report('2026-10-20', { locale })
        .projects.flatMap((project) => project.agents)
        .flatMap((agent) => agent.commits.map((commit) => commit.subject)),
    );
    expect(subjects[0]?.length).toBeGreaterThan(0);
    expect(subjects[0]).not.toEqual(subjects[1]);
    expect(subjects[1]).not.toEqual(subjects[2]);
    for (const list of subjects) for (const subject of list) expect(subject).not.toMatch(/demo\.report|\{/);
  });

  test('requests appear only when asked for', () => {
    const without = report('2026-10-20').projects.flatMap((project) => project.agents);
    const withRequests = report('2026-10-20', { includeRequests: true }).projects.flatMap((project) => project.agents);
    expect(without.every((agent) => agent.requests === undefined)).toBe(true);
    expect(withRequests.every((agent) => (agent.requests?.length ?? 0) > 0)).toBe(true);
  });

  test('filters by account and uses the usage rows of the session when there are some', () => {
    const first = agents.find((agent) => agent.kind === 'main');
    if (first === undefined) throw new Error('no agent');
    const only = report('2026-10-21', { account: first.accountId });
    expect(
      only.projects.flatMap((project) => project.agents).every((agent) => agent.accountId === first.accountId),
    ).toBe(true);
    const row = {
      hour: new Date(2026, 9, 21, 10).getTime(),
      account: first.accountId,
      project: first.projectId,
      model: 'claude-sonnet-5-5',
      session: first.sessionId,
      agent: '',
      input: 1000,
      output: 500,
      cacheWrite: 0,
      cacheRead: 0,
      costUSD: 1.25,
    };
    const withRows = report('2026-10-21', { usageRows: [row] })
      .projects.flatMap((project) => project.agents)
      .find((agent) => agent.sessionId === first.sessionId);
    if (withRows !== undefined) expect(withRows.usage).toEqual({ tokens: 1500, costUSD: 1.25 });
  });
});
