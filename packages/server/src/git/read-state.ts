// Reads the state of one repository with read-only git commands (never fetch, never write, never run a hook).
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { GitOperation, ProjectGit } from '@ai-office/shared';
import { countStash, parseLastCommit, parseShortstat, parseStatus } from './parse-status';
import { GIT_TIMEOUT_MS, type Runner } from './run';

/**
 * Prefix of every command. `core.fsmonitor=false` keeps a repository's configuration from starting a program on our
 * behalf; the diff flags keep external diff tools and text conversion filters out.
 */
const BASE_ARGS = ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false'] as const;
const DIFF_ARGS = ['diff', '--shortstat', '--no-ext-diff', '--no-textconv'] as const;

/** Files (or folders) inside the git directory that tell an operation is in progress, in order of precedence. */
const OPERATION_MARKERS: readonly (readonly [string, GitOperation])[] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert'],
  ['BISECT_LOG', 'bisect'],
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The git directory of a project: `.git` itself, or the folder a `.git` file ("gitdir: ...", worktrees) points to. */
export async function findGitDir(projectPath: string): Promise<string | undefined> {
  const dotGit = join(projectPath, '.git');
  let info;
  try {
    info = await stat(dotGit);
  } catch {
    return undefined;
  }
  if (info.isDirectory()) return dotGit;
  try {
    const match = /^gitdir:\s*(.+)$/m.exec((await readFile(dotGit, 'utf8')).slice(0, 4096));
    if (match === null) return undefined;
    const target = (match[1] as string).trim();
    return isAbsolute(target) ? target : resolve(projectPath, target);
  } catch {
    return undefined;
  }
}

export async function detectOperation(gitDir: string): Promise<GitOperation | undefined> {
  for (const [marker, operation] of OPERATION_MARKERS) if (await exists(join(gitDir, marker))) return operation;
  return undefined;
}

async function attempt(run: () => Promise<string>): Promise<string | undefined> {
  try {
    return await run();
  } catch {
    return undefined;
  }
}

/**
 * Reads the state of the repository at `projectPath`. Rejects (a RunError) when `status` itself fails: not a
 * repository, git missing, timeout. The extra pieces (line counts, last commit, stash) are best effort.
 */
export async function readGitState(run: Runner, projectPath: string): Promise<ProjectGit> {
  const options = { cwd: projectPath, timeoutMs: GIT_TIMEOUT_MS };
  const git = (...args: string[]): Promise<string> => run('git', [...BASE_ARGS, ...args], options);

  const status = parseStatus(await git('status', '--porcelain=v2', '--branch', '--untracked-files=normal'));
  const unstagedStat = status.unstaged + status.conflicted > 0 ? await attempt(() => git(...DIFF_ARGS)) : undefined;
  const stagedStat = status.staged > 0 ? await attempt(() => git(...DIFF_ARGS, '--cached')) : undefined;
  const lines = [parseShortstat(unstagedStat ?? ''), parseShortstat(stagedStat ?? '')];
  const commit = status.head === undefined ? undefined : await attempt(() => git('log', '-1', '--no-show-signature', '--format=%h%x09%ct%x09%s'));
  const stash = await attempt(() => git('stash', 'list'));
  const gitDir = await findGitDir(projectPath);
  const op = gitDir === undefined ? undefined : await detectOperation(gitDir);
  const lastCommit = commit === undefined ? undefined : parseLastCommit(commit);

  return {
    ...(status.branch !== undefined ? { branch: status.branch } : {}),
    ...(status.detached && status.head !== undefined ? { head: status.head } : {}),
    ...(status.detached ? { detached: true } : {}),
    staged: status.staged,
    unstaged: status.unstaged,
    untracked: status.untracked,
    conflicted: status.conflicted,
    insertions: lines[0].insertions + lines[1].insertions,
    deletions: lines[0].deletions + lines[1].deletions,
    ...(status.upstream !== undefined ? { upstream: status.upstream } : {}),
    ...(status.ahead !== undefined && status.behind !== undefined ? { ahead: status.ahead, behind: status.behind } : {}),
    ...(lastCommit !== undefined ? { lastCommit } : {}),
    stash: stash === undefined ? 0 : countStash(stash),
    ...(op !== undefined ? { op } : {}),
  };
}
