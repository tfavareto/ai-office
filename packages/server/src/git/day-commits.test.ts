import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { DayRange } from '@ai-office/shared';
import { makeTempDir, removeDir } from '../test-helpers';
import { readDayCommits } from './day-commits';
import { RunError, createGitRunner, type Runner } from './run';

const DAY: DayRange = { date: '2026-10-19', start: Date.parse('2026-10-19T03:00:00Z'), end: Date.parse('2026-10-20T03:00:00Z') };
const seconds = (iso: string): number => Date.parse(iso) / 1000;

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir('ai-office-daycommits-');
});
afterEach(() => removeDir(dir));

function fake(log: string, email: string | Error = 'me@example.com'): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const run: Runner = (_file, args) => {
    calls.push([...args]);
    if (args.includes('config')) return email instanceof Error ? Promise.reject(email) : Promise.resolve(`${email}\n`);
    return Promise.resolve(log);
  };
  return { run, calls };
}

describe('readDayCommits with a fake runner', () => {
  test('is empty for a folder that is not a repository, without starting anything', async () => {
    const { run, calls } = fake('');
    expect(await readDayCommits(run, dir, DAY)).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('returns the commits of the day marked as coming from git, and drops any outside the range', async () => {
    // Arrange
    await mkdir(join(dir, '.git'));
    const { run } = fake([`a1b2c3d\t${seconds('2026-10-19T12:00:00Z')}\tfeat: inside`, `e4f5a6b\t${seconds('2026-10-18T12:00:00Z')}\tfix: day before`, 'garbage'].join('\n'));
    // Act
    const commits = await readDayCommits(run, dir, DAY);
    // Assert
    expect(commits).toEqual([{ hash: 'a1b2c3d', subject: 'feat: inside', at: Date.parse('2026-10-19T12:00:00Z'), source: 'git' }]);
  });

  test('asks for read-only history of the person, between the two instants of the day', async () => {
    // Arrange
    await mkdir(join(dir, '.git'));
    const { run, calls } = fake('');
    // Act
    await readDayCommits(run, dir, DAY);
    // Assert
    const log = calls.find((args) => args.includes('log')) as string[];
    expect(log).toEqual(expect.arrayContaining(['--no-optional-locks', 'core.fsmonitor=false', '--fixed-strings', '--author=me@example.com', `--since=${new Date(DAY.start).toISOString()}`, `--until=${new Date(DAY.end).toISOString()}`]));
    const writing = ['fetch', 'pull', 'push', 'commit', 'add', 'checkout', 'reset', 'merge', 'rebase', 'gc'];
    for (const args of calls) expect(args.some((arg) => writing.includes(arg))).toBe(false);
  });

  test('does not filter by author when none is configured', async () => {
    await mkdir(join(dir, '.git'));
    const { run, calls } = fake('', new RunError('no key', 1, '', false));
    await readDayCommits(run, dir, DAY);
    expect((calls.find((args) => args.includes('log')) as string[]).some((arg) => arg.startsWith('--author'))).toBe(false);
  });

  test('rejects when git fails, so the report can leave the project as it is', async () => {
    await mkdir(join(dir, '.git'));
    const run: Runner = (_file, args) => (args.includes('config') ? Promise.resolve('') : Promise.reject(new RunError('boom', 128, 'fatal', false)));
    await expect(readDayCommits(run, dir, DAY)).rejects.toBeInstanceOf(RunError);
  });
});

describe('readDayCommits on a real repository created by the test', () => {
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const hasGit = ((): boolean => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  test.skipIf(!hasGit)('lists the commits of the day by the configured user, newest first', async () => {
    // Arrange: a throw-away repository with two commits of mine and one of someone else, all at noon of the day
    const repo = await makeTempDir('ai-office-repo-');
    try {
      const git = (...args: string[]): void => void execFileSync('git', args, { cwd: repo, env: { ...environment, GIT_AUTHOR_DATE: '2026-10-19T12:00:00Z', GIT_COMMITTER_DATE: '2026-10-19T12:00:00Z' }, stdio: 'ignore' });
      git('init', '-q', '-b', 'main');
      git('config', 'user.name', 'Me');
      git('config', 'user.email', 'me@example.com');
      git('config', 'commit.gpgsign', 'false');
      await writeFile(join(repo, 'a.txt'), '1\n');
      git('add', '.');
      git('commit', '-q', '-m', 'first');
      await writeFile(join(repo, 'a.txt'), '2\n');
      git('commit', '-q', '-am', 'second');
      await writeFile(join(repo, 'a.txt'), '3\n');
      git('commit', '-q', '-am', 'theirs', '--author=Other <other@example.com>');
      // The production time limit is 3 s; a busy test machine may need longer to start the program.
      const real = createGitRunner({ PATH: process.env.PATH, HOME: repo });
      const run: Runner = (file, args, options) => real(file, args, { ...options, timeoutMs: 60_000 });
      // Act
      const commits = await readDayCommits(run, repo, DAY);
      // Assert
      expect(commits.map((commit) => commit.subject)).toEqual(['second', 'first']);
      expect(commits.every((commit) => commit.source === 'git')).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
