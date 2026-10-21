// Presentation logic of a room's repository: which parts the Git section shows and with what meaning. Pure; the
// components turn these descriptions into (translated) text.
import {
  GIT_FAILING_MAX,
  gitRef,
  isDirty,
  type CiState,
  type GitChecks,
  type GitOperation,
  type GitPullRequest,
  type ProjectGit,
  type PullRequestState,
  type ReviewDecision,
} from '@ai-office/shared';

export type ChangeKind = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

export interface ChangeCount {
  kind: ChangeKind;
  n: number;
}

/** The kinds of change that exist, most important first; conflicts lead because they need a hand. */
export function changeCounts(git: ProjectGit): ChangeCount[] {
  const all: ChangeCount[] = [
    { kind: 'conflicted', n: git.conflicted },
    { kind: 'staged', n: git.staged },
    { kind: 'unstaged', n: git.unstaged },
    { kind: 'untracked', n: git.untracked },
  ];
  return all.filter((count) => count.n > 0);
}

/** Lines added and removed, when there is something to say. */
export function lineChanges(git: ProjectGit): { insertions: number; deletions: number } | null {
  return git.insertions + git.deletions > 0 ? { insertions: git.insertions, deletions: git.deletions } : null;
}

export type SyncState =
  | { kind: 'no-upstream' }
  | { kind: 'in-sync'; upstream: string }
  | { kind: 'diverged'; upstream: string; ahead: number; behind: number };

/** Where the branch stands against its upstream (a detached HEAD has no branch to compare). */
export function syncState(git: ProjectGit): SyncState {
  if (git.upstream === undefined || git.ahead === undefined || git.behind === undefined) return { kind: 'no-upstream' };
  if (git.ahead === 0 && git.behind === 0) return { kind: 'in-sync', upstream: git.upstream };
  return { kind: 'diverged', upstream: git.upstream, ahead: git.ahead, behind: git.behind };
}

/** The checks worth listing under the CI badge: how many passed, which failed, how many still run. */
export interface ChecksView {
  total: number;
  passed: number;
  failing: readonly string[];
  /** Failed checks beyond the names that travel in the snapshot. */
  moreFailing: number;
  pending: number;
}

export function checksView(checks: GitChecks): ChecksView {
  const failing = (checks.failing ?? []).slice(0, GIT_FAILING_MAX);
  return {
    total: checks.total,
    passed: checks.passed,
    failing,
    moreFailing: Math.max(0, checks.failed - failing.length),
    pending: checks.pending,
  };
}

export type PrTone = 'ok' | 'warn' | 'bad' | 'muted';

export const CI_TONE: Readonly<Record<CiState, PrTone>> = {
  success: 'ok',
  pending: 'warn',
  failure: 'bad',
  none: 'muted',
};

/** Message state of a pull request, as the badge reads it (a draft is an open pull request that is not ready). */
export type PrBadgeState = PullRequestState | 'draft';

export function prBadgeState(pr: GitPullRequest): PrBadgeState {
  return pr.state === 'open' && pr.draft ? 'draft' : pr.state;
}

export const REVIEW_TONE: Readonly<Record<ReviewDecision, PrTone>> = {
  approved: 'ok',
  'changes-requested': 'bad',
  'review-required': 'warn',
};

/** Everything the sidebar row needs from a room's repository. */
export interface BranchChip {
  label: string;
  dirty: boolean;
  op: GitOperation | null;
  detached: boolean;
}

export function branchChip(git: ProjectGit | undefined): BranchChip | null {
  if (git === undefined) return null;
  const label = gitRef(git);
  if (label === '') return null;
  return { label, dirty: isDirty(git), op: git.op ?? null, detached: git.detached === true };
}
