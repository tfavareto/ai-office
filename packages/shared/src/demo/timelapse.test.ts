import { describe, expect, test } from 'vitest';
import { LOCALES } from '../i18n';
import { dayRange, reportDates } from '../report/range';
import type { TimelapseEvent } from '../timelapse/types';
import { createDemoSimulator } from './simulator';
import { demoTimelapse } from './timelapse';

const NOW = new Date(2026, 9, 21, 15, 30).getTime();
const agents = createDemoSimulator({ seed: 3, now: () => NOW }).agents();

function day(date: string, over: Partial<Parameters<typeof demoTimelapse>[0]> = {}) {
  const range = dayRange(date);
  if (range === undefined) throw new Error('bad date');
  return demoTimelapse({ range, now: NOW, locale: 'pt-BR', agents, account: 'all', ...over });
}

const WORKDAYS = ['2026-10-21', '2026-10-20', '2026-10-19', '2026-10-16'];

describe('demoTimelapse', () => {
  test('is deterministic for a date and a language', () => {
    expect(day('2026-10-20')).toEqual(day('2026-10-20'));
  });

  test.each(WORKDAYS)(
    '%s tells a full story: several rooms, arrivals, meetings, waits, commits, a shell and tests',
    (date) => {
      const tl = day(date);
      const types = new Set(tl.events.map((event) => event.type));

      expect(tl.demo).toBe(true);
      expect(tl.projects.length).toBeGreaterThanOrEqual(3);
      expect(tl.agents.some((agent) => agent.kind === 'sub')).toBe(true);
      for (const type of [
        'arrive',
        'leave',
        'status',
        'activity',
        'tasks',
        'shell',
        'permission',
        'commit',
        'test',
      ] as const)
        expect(types.has(type), type).toBe(true);
      expect(tl.events.some((event) => event.type === 'status' && event.status === 'waiting')).toBe(true);
    },
  );

  test('over the week there is a failed test run', () => {
    const failed = reportDates(NOW).some((date) =>
      day(date).events.some((event) => event.type === 'test' && event.outcome === 'failed'),
    );

    expect(failed).toBe(true);
  });

  test('is consistent: ordered, in range, every index valid, everybody arrives before anything else and subagents have a parent', () => {
    for (const date of reportDates(NOW)) {
      const tl = day(date);
      const arrived = new Set<number>();
      let previous = -Infinity;
      for (const event of tl.events) {
        expect(event.at, date).toBeGreaterThanOrEqual(previous);
        previous = event.at;
        expect(event.at).toBeGreaterThanOrEqual(tl.start);
        expect(event.at).toBeLessThanOrEqual(NOW);
        if (event.type === 'commit') {
          expect(tl.projects[event.project]).toBeDefined();
          continue;
        }
        expect(tl.agents[event.agent], `${date} ${event.type}`).toBeDefined();
        if (event.type === 'arrive') arrived.add(event.agent);
        else if (event.type !== 'test')
          expect(arrived.has(event.agent), `${date} ${event.type} before arriving`).toBe(true);
      }
      for (const agent of tl.agents)
        if (agent.kind === 'sub')
          expect(
            tl.agents.some((candidate) => candidate.id === agent.parentId),
            agent.id,
          ).toBe(true);
      if (tl.events.length > 0) expect([tl.from, tl.to]).toEqual([tl.events[0]?.at, expect.any(Number)]);
    }
  });

  test('today never goes past now, and the people of the live office are among the people of the day', () => {
    const tl = day('2026-10-21');
    const mains = agents.filter((agent) => agent.kind === 'main');

    expect(tl.to).toBeLessThanOrEqual(NOW);
    expect(
      tl.agents
        .filter((agent) => agent.kind === 'main')
        .some((agent) => mains.some((main) => main.id === agent.id && main.name === agent.name)),
    ).toBe(true);
  });

  test('says everything in message keys, so every language can read it; only the commit subjects follow the requested language', () => {
    const [pt, en, es] = LOCALES.map((locale) => day('2026-10-20', { locale }));
    const strip = (tl: typeof pt): unknown => ({
      ...tl,
      events: tl?.events.map((event) => (event.type === 'commit' ? { ...event, subject: '' } : event)),
    });

    expect(strip(pt)).toEqual(strip(en));
    expect(strip(en)).toEqual(strip(es));
    const subjects = (tl: typeof pt): string[] =>
      (tl?.events ?? []).flatMap((event: TimelapseEvent) => (event.type === 'commit' ? [event.subject] : []));
    expect(subjects(pt)).not.toEqual(subjects(en));
    expect(subjects(en)).not.toEqual(subjects(es));
    for (const event of pt?.events ?? [])
      if (event.type === 'activity') expect(event.msg.key).toMatch(/^(activity|timelapse\.activity)\./);
  });

  test('never carries a prompt: new tasks are only announced', () => {
    const prompts = day('2026-10-20').events.filter((event) => event.type === 'activity' && event.kind === 'prompt');

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.every((event) => event.type === 'activity' && event.msg.key === 'timelapse.activity.prompt')).toBe(
      true,
    );
  });

  test('an account filter keeps only that account, and an unknown one leaves an empty day', () => {
    const one = day('2026-10-20', { account: agents[0]?.accountId ?? '' });
    const none = day('2026-10-20', { account: 'nobody' });

    expect(one.agents.length).toBeGreaterThan(0);
    expect(one.agents.every((agent) => agent.accountId === agents[0]?.accountId)).toBe(true);
    expect(none).toMatchObject({ projects: [], agents: [], events: [] });
  });

  test('early in the morning today there is a little to watch, squeezed into the time there is', () => {
    const early = new Date(2026, 9, 21, 0, 40).getTime();
    const tl = day('2026-10-21', { now: early });

    expect(tl.events.length).toBeGreaterThan(0);
    expect(tl.events.every((event) => event.at <= early)).toBe(true);
  });
});
