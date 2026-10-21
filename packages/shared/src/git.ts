// Git state of a project folder (a room): what the server reads from the repository (read-only) and, when the person
// turned it on, from the user's own `gh` CLI. Everything is optional in the snapshot: a folder that is not a repository,
// a computer without git, or a repository that could not be read simply has no `git` field.

/** An operation a repository is in the middle of. */
export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

export const GIT_OPERATIONS: readonly GitOperation[] = ['merge', 'rebase', 'cherry-pick', 'revert', 'bisect'];

export interface GitCommit {
  /** Abbreviated hash (7 to 12 characters). */
  hash: string;
  /** First line of the message, at most GIT_SUBJECT_MAX characters. */
  subject: string;
  /** Commit time, epoch ms. */
  at: number;
}

/** State of the checks of a pull request, from the least to the most worrying: none < success < pending < failure. */
export type CiState = 'none' | 'success' | 'pending' | 'failure';

export interface GitChecks {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  /** Names of the first failing checks (at most GIT_FAILING_MAX). */
  failing?: string[];
}

export type PullRequestState = 'open' | 'merged' | 'closed';
export type ReviewDecision = 'approved' | 'changes-requested' | 'review-required';

/** The pull request of the current branch, as `gh pr view` reports it. */
export interface GitPullRequest {
  number: number;
  title: string;
  state: PullRequestState;
  /** http(s) address of the pull request. */
  url: string;
  draft: boolean;
  review?: ReviewDecision;
  ci: CiState;
  checks: GitChecks;
}

export interface ProjectGit {
  /** Current branch; absent on a detached HEAD (then `head` holds the abbreviated commit). */
  branch?: string;
  head?: string;
  detached?: boolean;
  /** Changes in the working tree: files with staged changes, with unstaged changes, untracked, and with conflicts. */
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  /** Lines added and removed in tracked files (staged and unstaged together). */
  insertions: number;
  deletions: number;
  /** Upstream branch (`origin/main`); absent when the branch tracks nothing. */
  upstream?: string;
  /** Commits ahead of / behind the upstream; only with an upstream. */
  ahead?: number;
  behind?: number;
  lastCommit?: GitCommit;
  /** Entries in the stash. */
  stash: number;
  /** Operation in progress (merge, rebase...). */
  op?: GitOperation;
  /** Only when pull requests are enabled and `gh` found one for the branch. */
  pr?: GitPullRequest;
}

export const GIT_SUBJECT_MAX = 120;
export const GIT_BRANCH_MAX = 200;
export const GIT_TITLE_MAX = 200;
export const GIT_FAILING_MAX = 3;

/** How `gh` is doing, for the settings screen. */
export type GhStatus = 'unknown' | 'ready' | 'missing' | 'unauthenticated';

export const GH_STATUSES: readonly GhStatus[] = ['unknown', 'ready', 'missing', 'unauthenticated'];

/** Settings of the git integration that live on the server (GET / POST /api/git/settings). */
export interface GitSettings {
  /** Ask `gh` for the pull request of each room's branch (the only thing that uses the internet). Off by default. */
  pullRequests: boolean;
  gh: GhStatus;
}

/** Files with changes of any kind. */
export function changedFiles(git: ProjectGit): number {
  return git.staged + git.unstaged + git.untracked + git.conflicted;
}

export function isDirty(git: ProjectGit): boolean {
  return changedFiles(git) > 0;
}

/** Name shown for the checkout: the branch, else the abbreviated commit of a detached HEAD. */
export function gitRef(git: ProjectGit): string {
  return git.branch ?? git.head ?? '';
}

/** Overall state of a list of checks: any failure wins, then anything still running, then success. */
export function ciOfChecks(checks: GitChecks): CiState {
  if (checks.total === 0) return 'none';
  if (checks.failed > 0) return 'failure';
  if (checks.pending > 0) return 'pending';
  return 'success';
}

/** Light of the room's plaque: only an open pull request has one. */
export function ciLight(git: ProjectGit | undefined): CiState {
  const pr = git?.pr;
  return pr !== undefined && pr.state === 'open' ? pr.ci : 'none';
}
