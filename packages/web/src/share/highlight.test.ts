import { reportAgent, reportProject } from '@ai-office/shared';
import { describe, expect, it } from 'vitest';
import { pickCaption, pickHighlight } from './highlight';

const commit = (hash: string) => ({ hash, subject: 'secret subject', at: 1, source: 'transcript' as const });
const task = (title: string) => ({ title, at: 1 });
const run = (outcome: 'passed' | 'failed') => ({ runner: 'vitest', at: 1, outcome });
const file = (path: string, added = 1) => ({ path, edits: 1, added, removed: 0 });

const busy = reportProject(
  [reportAgent({ agentId: 'a', tasks: [task('t1'), task('t2')], commits: [commit('aaa111')] })],
  { id: '/work/acme-bank', name: 'acme-bank' },
);
const quiet = reportProject([reportAgent({ agentId: 'b' })], { id: '/work/blog', name: 'blog' });
const choice = { showProjectNames: false, unknownProject: 'Unknown' };
const when = { when: 'today' as const, date: '25 October 2026', url: 'github.com/x/y', time: '3 h 05 min' };

describe('pickHighlight', () => {
  it('names the busiest project only when names are on', () => {
    const msg = pickHighlight({ projects: [quiet, busy] }, { ...choice, showProjectNames: true });

    expect(msg).toEqual({ key: 'share.highlight.topProject', params: { project: 'acme-bank', tasks: 2, commits: 1 } });
  });

  it('never carries a project name when names are off', () => {
    const msg = pickHighlight({ projects: [quiet, busy] }, choice);

    expect(JSON.stringify(msg)).not.toMatch(/acme-bank|blog/);
  });

  it('celebrates test runs that all passed', () => {
    const green = reportProject([reportAgent({ tests: [run('passed'), run('passed')] })]);

    expect(pickHighlight({ projects: [green] }, choice)).toEqual({
      key: 'share.highlight.testsGreen',
      params: { n: 2 },
    });
  });

  it('skips the tests line when one failed', () => {
    const mixed = reportProject([reportAgent({ tests: [run('passed'), run('failed')] })]);

    expect(pickHighlight({ projects: [mixed] }, choice).key).not.toBe('share.highlight.testsGreen');
  });

  it('talks about the lines written on a big day', () => {
    const big = reportProject([reportAgent({ files: [file('a.ts', 80), file('b.ts', 40)] })]);

    expect(pickHighlight({ projects: [big] }, choice)).toEqual({
      key: 'share.highlight.lines',
      params: { added: 120, removed: 0, files: 2 },
    });
  });

  it('counts the rooms working in parallel', () => {
    expect(pickHighlight({ projects: [quiet, quiet] }, choice)).toEqual({
      key: 'share.highlight.parallel',
      params: { rooms: 2, agents: 2 },
    });
  });

  it('falls back to a line about the office', () => {
    expect(pickHighlight({ projects: [quiet] }, choice)).toEqual({ key: 'share.highlight.default' });
  });

  it('uses the stand-in name for a project without a name', () => {
    const unnamed = reportProject([reportAgent({ tasks: [task('t')] })], { id: '/x', name: '' });

    const msg = pickHighlight({ projects: [unnamed] }, { ...choice, showProjectNames: true });

    expect(msg.params?.project).toBe('Unknown');
  });
});

describe('pickCaption', () => {
  it('says tasks and commits when there were both', () => {
    const msg = pickCaption({ projects: [busy] }, when);

    expect(msg.key).toBe('share.caption.tasksCommits');
    expect(msg.params).toMatchObject({ tasks: 2, commits: 1, today: 1, url: 'github.com/x/y' });
  });

  it('says only the tasks when there were no commits', () => {
    const tasksOnly = reportProject([reportAgent({ tasks: [task('t')] })]);

    expect(pickCaption({ projects: [tasksOnly] }, when).key).toBe('share.caption.tasks');
  });

  it('says only the commits when there were no tasks', () => {
    const commitsOnly = reportProject([reportAgent({ commits: [commit('b')] })]);

    expect(pickCaption({ projects: [commitsOnly] }, when).key).toBe('share.caption.commits');
  });

  it('says the time worked on a day with neither', () => {
    const msg = pickCaption({ projects: [quiet] }, when);

    expect(msg).toEqual({
      key: 'share.caption.time',
      params: { today: 1, date: '25 October 2026', url: 'github.com/x/y', agents: 1, time: '3 h 05 min' },
    });
  });

  it('never carries project names, task texts or commit subjects', () => {
    const msg = pickCaption({ projects: [busy] }, when);

    expect(JSON.stringify(msg)).not.toMatch(/acme-bank|t1|secret subject/);
  });
});
