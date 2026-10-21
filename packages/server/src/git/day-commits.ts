// Commits of one day for the day report: the person's own commits on every branch, read with `log` (read-only).
import type { DayRange, ReportCommit } from '@ai-office/shared';
import { parseCommitLog } from './parse-status';
import { findGitDir } from './read-state';
import { GIT_TIMEOUT_MS, type Runner } from './run';

const MAX_COMMITS = 100;
const BASE_ARGS = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false'] as const;

/**
 * Commits made on `range` in the repository at `projectPath` by the configured user (all commits when no user is
 * configured). Empty for a folder that is not a repository; rejects when git fails.
 */
export async function readDayCommits(run: Runner, projectPath: string, range: DayRange): Promise<ReportCommit[]> {
  if ((await findGitDir(projectPath)) === undefined) return [];
  const options = { cwd: projectPath, timeoutMs: GIT_TIMEOUT_MS };
  const email = (await run('git', [...BASE_ARGS, 'config', '--get', 'user.email'], options).catch(() => '')).trim();
  const filter =
    email.length > 0 && email.length <= 200 && !email.startsWith('-')
      ? ['--fixed-strings', '--regexp-ignore-case', `--author=${email}`]
      : [];
  const output = await run(
    'git',
    [
      ...BASE_ARGS,
      'log',
      '--all',
      '--no-merges',
      '--no-show-signature',
      `--since=${new Date(range.start).toISOString()}`,
      `--until=${new Date(range.end).toISOString()}`,
      `--max-count=${MAX_COMMITS}`,
      ...filter,
      '--format=%h%x09%ct%x09%s',
    ],
    options,
  );
  return parseCommitLog(output)
    .filter((commit) => commit.at >= range.start && commit.at < range.end)
    .map((commit): ReportCommit => ({ hash: commit.hash, subject: commit.subject, at: commit.at, source: 'git' }));
}
