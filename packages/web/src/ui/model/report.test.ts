import { afterEach, describe, expect, it } from 'vitest';
import { REPORT_BUCKETS, REPORT_BUCKET_MS, reportAgent, reportProject } from '@ai-office/shared';
import { setLocale } from '../../i18n';
import {
  formatWorkTime,
  intensity,
  projectLabel,
  reportFilename,
  reportHighlights,
  reportSections,
  sumActivity,
  testsByRunner,
  toolSummary,
} from './report';

const commit = (hash: string) => ({ hash, subject: 'x', at: 1, source: 'transcript' as const });
const task = (title: string) => ({ title, at: 1 });
const run = (outcome: 'passed' | 'failed' | 'unknown', runner = 'vitest') => ({ runner, at: 1, outcome });
const file = (path: string) => ({ path, edits: 1, added: 2, removed: 1 });

describe('reportSections', () => {
  const ana = reportAgent({ agentId: 'a', name: 'Ana', activeMs: 100, files: [file('a.ts')] });
  const bruno = reportAgent({ agentId: 'b', name: 'Bruno', activeMs: 300, files: [file('b.ts')] });
  const blog = reportAgent({ agentId: 'c', name: 'Carla', activeMs: 50 });
  const report = {
    projects: [
      reportProject([bruno, ana], { id: '/loja', name: 'loja' }),
      reportProject([blog], { id: '/blog', name: 'blog' }),
    ],
  };

  it('groups by project keeping the order of the report and totals per project', () => {
    const sections = reportSections(report, 'project');
    expect(sections.map((section) => section.title)).toEqual(['loja', 'blog']);
    expect(sections[0]?.totals).toMatchObject({ agents: 2, files: 2 });
    expect(sections[0]?.entries.map((entry) => entry.agent.name)).toEqual(['Bruno', 'Ana']);
  });

  it('groups by agent, busiest first, with the project as subtitle', () => {
    const sections = reportSections(report, 'agent');
    expect(sections.map((section) => [section.title, section.subtitle])).toEqual([
      ['Bruno', 'loja'],
      ['Ana', 'loja'],
      ['Carla', 'blog'],
    ]);
    expect(sections[0]?.totals.files).toBe(1);
  });

  it('names a project without a folder', () => {
    expect(projectLabel({ name: '' })).toBe('Projeto desconhecido');
    expect(projectLabel({ name: 'loja' })).toBe('loja');
  });
});

describe('small helpers', () => {
  it('sums buckets of several agents and clamps the intensity', () => {
    const a = reportAgent({ activity: Array.from({ length: REPORT_BUCKETS }, (_, i) => (i === 0 ? 60_000 : 0)) });
    const b = reportAgent({ activity: Array.from({ length: REPORT_BUCKETS }, (_, i) => (i === 0 ? 30_000 : 0)) });
    expect(sumActivity([a, b])[0]).toBe(90_000);
    expect(intensity(REPORT_BUCKET_MS / 2)).toBe(0.5);
    expect(intensity(REPORT_BUCKET_MS * 3)).toBe(1);
    expect(intensity(-5)).toBe(0);
  });

  it('keeps a work time past 24 hours in hours', () => {
    expect(formatWorkTime(90 * 60_000)).toBe('1 h 30 min');
    expect(formatWorkTime(26 * 3_600_000 + 5 * 60_000)).toBe('26 h 05 min');
  });

  it('names the file after the date', () => {
    expect(reportFilename('2026-10-21')).toBe('ai-office-2026-10-21.md');
  });

  it('lists tool calls most used first and leaves out the unused', () => {
    expect(toolSummary({ toolCalls: { read: 2, bash: 9, web: 0 } }).map((entry) => entry.kind)).toEqual([
      'bash',
      'read',
    ]);
  });

  it('groups test runs by runner', () => {
    expect(testsByRunner([run('passed'), run('failed'), run('passed'), run('unknown', 'jest')])).toEqual([
      { runner: 'vitest', passed: 2, failed: 1, unknown: 0 },
      { runner: 'jest', passed: 0, failed: 0, unknown: 1 },
    ]);
  });
});

describe('reportHighlights', () => {
  afterEach(() => setLocale('pt-BR'));

  it('says what each person got done, best first, in the language of the interface', () => {
    const ana = reportAgent({
      name: 'Ana',
      tasks: [task('a'), task('b'), task('c'), task('d')],
      commits: [commit('1'), commit('2'), commit('3')],
    });
    const bruno = reportAgent({ agentId: 'b', name: 'Bruno', tests: [run('passed'), run('passed')] });
    const carla = reportAgent({ agentId: 'c', name: 'Carla', commits: [commit('9')] });
    const report = { projects: [reportProject([bruno, ana, carla], { name: 'loja-online' })] };
    expect(reportHighlights(report)).toEqual([
      'Ana fechou 4 tarefas e fez 3 commits em loja-online',
      'Carla fez 1 commit em loja-online',
      'Bruno rodou os testes 2 vezes em loja-online e tudo passou',
    ]);
    setLocale('en');
    expect(reportHighlights(report)[0]).toBe('Ana closed 4 tasks and made 3 commits in loja-online');
    setLocale('es');
    expect(reportHighlights(report)[0]).toBe('Ana cerró 4 tareas e hizo 3 commits en loja-online');
  });

  it('warns about failing tests first and mentions files only when there are enough of them', () => {
    const failing = reportAgent({ name: 'Ana', tests: [run('failed'), run('passed')] });
    const editor = reportAgent({ agentId: 'b', name: 'Bruno', files: [file('a'), file('b'), file('c')] });
    const few = reportAgent({ agentId: 'c', name: 'Carla', files: [file('a')] });
    const lines = reportHighlights({ projects: [reportProject([failing, editor, few], { name: 'api' })] });
    expect(lines[0]).toBe('Atenção: 1 execução de testes falhou em api');
    expect(lines).toContain('Ana rodou os testes 2 vezes em api; 1 falhou');
    expect(lines).toContain('Bruno alterou 3 arquivos em api (+6 −3)');
    expect(lines.join('\n')).not.toContain('Carla');
  });

  it('points at who spent most of the day, only with several people and a clear lead', () => {
    const big = reportAgent({ name: 'Ana', usage: { tokens: 1, costUSD: 9 } });
    const small = reportAgent({ agentId: 'b', name: 'Bruno', usage: { tokens: 1, costUSD: 1 } });
    expect(reportHighlights({ projects: [reportProject([big, small])] })).toEqual([
      'Ana concentrou 90% do custo do dia (US$ 9,00)',
    ]);
    expect(reportHighlights({ projects: [reportProject([big])] })).toEqual([]);
    const even = [
      reportAgent({ name: 'A', usage: { tokens: 1, costUSD: 1 } }),
      reportAgent({ agentId: 'b', name: 'B', usage: { tokens: 1, costUSD: 1 } }),
      reportAgent({ agentId: 'c', name: 'C', usage: { tokens: 1, costUSD: 1 } }),
    ];
    expect(reportHighlights({ projects: [reportProject(even)] })).toEqual([]);
  });

  it('keeps at most five sentences', () => {
    const agents = Array.from({ length: 9 }, (_, i) =>
      reportAgent({ agentId: `a${i}`, name: `P${i}`, commits: [commit(String(i))] }),
    );
    expect(reportHighlights({ projects: [reportProject(agents)] })).toHaveLength(5);
  });
});
