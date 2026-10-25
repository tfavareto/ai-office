import { type DayReport, reportAgent, reportProject } from '@ai-office/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n';
import { toDateKey } from '../ui/format';
import { buildCaption, buildCardModel, type CardInput } from './model';
import { REPO_URL } from './types';

const NOW = new Date(2026, 9, 25, 15, 0).getTime();
const TODAY = toDateKey(NOW);
const task = (title: string) => ({ title, at: 1 });
const commit = (hash: string, subject: string) => ({ hash, subject, at: 1, source: 'transcript' as const });

const SECRETS = [
  'acme-bank',
  'Fix the wire transfer',
  'rotate-prod-keys.ts',
  'git push --force origin',
  'secret subject',
  'Stripe',
];

function report(date = TODAY): DayReport {
  const agent = reportAgent({
    agentId: 'claude:s1',
    name: 'Ana',
    activeMs: 3 * 3_600_000 + 5 * 60_000,
    requests: ['Fix the wire transfer bug for Stripe'],
    tasks: [task('Rotate the production keys'), task('Write the migration')],
    commits: [commit('abc1234', 'secret subject')],
    files: [{ path: 'src/rotate-prod-keys.ts', edits: 1, added: 90, removed: 4 }],
    commands: [{ command: 'git push --force origin main', runs: 1 }],
    tests: [{ runner: 'vitest', at: 1, outcome: 'passed' }],
    usage: { tokens: 120_000, costUSD: 4.2 },
  });
  return {
    date,
    generatedAt: NOW,
    account: 'all',
    includeRequests: true,
    projects: [reportProject([agent], { id: '/Users/me/acme-bank', name: 'acme-bank' })],
  };
}

const input = (over: Partial<CardInput['options']> = {}, date = TODAY): CardInput => ({
  report: report(date),
  options: { showProjectNames: false, showUsage: false, ...over },
  now: NOW,
});

afterEach(() => setLocale('pt-BR'));

describe('buildCardModel', () => {
  it('shows the headline numbers of the day, formatted for the language', () => {
    setLocale('pt-BR');

    const model = buildCardModel(input());

    expect(model.stats.map((s) => [s.id, s.value, s.label])).toEqual([
      ['agents', '1', 'Agentes'],
      ['time', '3 h 05 min', 'Tempo ativo'],
      ['tasks', '2', 'Tarefas feitas'],
      ['commits', '1', 'Commits'],
      ['tests', '1', 'Testes ok'],
    ]);
  });

  it('writes the title and the date in each language', () => {
    const titles = (['pt-BR', 'en', 'es'] as const).map((locale) => {
      setLocale(locale);
      const model = buildCardModel(input());
      return [model.title, model.date];
    });

    expect(titles).toEqual([
      ['Meu escritório hoje', '25 de outubro de 2026'],
      ['My office today', 'October 25, 2026'],
      ['Mi oficina hoy', '25 de octubre de 2026'],
    ]);
  });

  it('names the date in the title when the report is not today', () => {
    setLocale('en');

    expect(buildCardModel(input({}, '2026-10-20')).title).toBe('My office on October 20, 2026');
  });

  it('keeps tokens and cost off the card by default', () => {
    setLocale('en');

    const model = buildCardModel(input());

    expect(model.stats.map((s) => s.id)).not.toContain('tokens');
    expect(JSON.stringify(model)).not.toMatch(/120|4\.2/);
  });

  it('shows tokens and cost when asked to', () => {
    setLocale('en');

    const stats = buildCardModel(input({ showUsage: true })).stats;

    expect(stats.find((s) => s.id === 'tokens')?.value).toBe('120K');
    expect(stats.find((s) => s.id === 'cost')?.value).toBe('$4.20');
  });

  it.each(['pt-BR', 'en', 'es'] as const)(
    'never carries what the user wrote or the project name by default (%s)',
    (locale) => {
      setLocale(locale);

      const text = JSON.stringify([buildCardModel(input()), buildCaption(input())]);

      for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
      expect(text).not.toContain('Ana');
    },
  );

  it('names the busiest project in the highlight only when names are on', () => {
    setLocale('en');

    const on = buildCardModel(input({ showProjectNames: true }));
    const off = buildCardModel(input());

    expect(on.highlight).toBe('acme-bank was the busiest project: 2 tasks and 1 commit');
    expect(off.highlight).not.toContain('acme-bank');
  });

  it('ends with the repository address', () => {
    expect(buildCardModel(input()).url).toBe(REPO_URL);
    expect(REPO_URL).toBe('github.com/tfavareto/ai-office');
  });
});

describe('buildCaption', () => {
  it('says what the team closed, in each language', () => {
    const captions = (['pt-BR', 'en', 'es'] as const).map((locale) => {
      setLocale(locale);
      return buildCaption(input());
    });

    expect(captions).toEqual([
      'Hoje meu time de agentes do Claude Code fechou 2 tarefas e 1 commit no AI Office 🏢 github.com/tfavareto/ai-office',
      'Today my Claude Code agent team wrapped up 2 tasks and 1 commit in AI Office 🏢 github.com/tfavareto/ai-office',
      'Hoy mi equipo de agentes de Claude Code cerró 2 tareas y 1 commit en AI Office 🏢 github.com/tfavareto/ai-office',
    ]);
  });

  it('uses the user numbers with the right plurals', () => {
    setLocale('pt-BR');
    const busy = report();
    const agent = busy.projects[0]?.agents[0];
    if (!agent) throw new Error('fixture');
    const many = {
      ...busy,
      projects: [
        {
          ...(busy.projects[0] as NonNullable<(typeof busy.projects)[0]>),
          agents: [
            {
              ...agent,
              tasks: Array.from({ length: 23 }, (_, i) => task(`t${i}`)),
              commits: Array.from({ length: 9 }, (_, i) => commit(`c${i}`, 's')),
            },
          ],
        },
      ],
    };

    expect(buildCaption({ ...input(), report: many })).toBe(
      'Hoje meu time de agentes do Claude Code fechou 23 tarefas e 9 commits no AI Office 🏢 github.com/tfavareto/ai-office',
    );
  });

  it('names the date when the report is not today', () => {
    setLocale('en');

    expect(buildCaption(input({}, '2026-10-20'))).toBe(
      'On October 20, 2026 my Claude Code agent team wrapped up 2 tasks and 1 commit in AI Office 🏢 github.com/tfavareto/ai-office',
    );
  });
});
