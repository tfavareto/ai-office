// Fake repository states for the demo rooms: clean, dirty, ahead, behind, a rebase and a merge in progress, a detached
// HEAD and pull requests with passing, failing and running checks. Deterministic (anchored at the demo's start) so the
// snapshot does not change from one tick to the next.
import { ciOfChecks, type GitChecks, type GitPullRequest, type ProjectGit } from '../git';

const MINUTE_MS = 60_000;
const SHORTSTAT_NONE = { insertions: 0, deletions: 0 };

interface DemoGitSpec {
  git: Omit<ProjectGit, 'pr' | 'lastCommit' | 'stash'> & { stash?: number };
  commit: { hash: string; subject: string; minutesAgo: number };
  pr?: Omit<GitPullRequest, 'ci' | 'url'>;
}

const clean = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, ...SHORTSTAT_NONE };

function checks(passed: number, failed: number, pending: number, failing: string[] = []): GitChecks {
  return { total: passed + failed + pending, passed, failed, pending, ...(failing.length > 0 ? { failing } : {}) };
}

const SPECS: readonly DemoGitSpec[] = [
  {
    // dirty, ahead, with a pull request whose tests fail
    git: { branch: 'feat/cupom', staged: 2, unstaged: 3, untracked: 1, conflicted: 0, insertions: 84, deletions: 21, upstream: 'origin/feat/cupom', ahead: 2, behind: 0 },
    commit: { hash: 'a41c9e2', subject: 'feat: apply coupon discount in the cart', minutesAgo: 12 },
    pr: { number: 142, title: 'Coupon discount in the cart', state: 'open', draft: false, review: 'review-required', checks: checks(7, 1, 1, ['unit-tests']) },
  },
  {
    // clean, approved, all checks passing
    git: { branch: 'fix/frete', ...clean, upstream: 'origin/fix/frete', ahead: 0, behind: 0 },
    commit: { hash: '7be03d1', subject: 'fix: round the shipping fee to cents', minutesAgo: 95 },
    pr: { number: 87, title: 'Fix shipping fee rounding', state: 'open', draft: false, review: 'approved', checks: checks(6, 0, 0) },
  },
  {
    // rebase in progress with conflicts
    git: { branch: 'feat/perfil', staged: 0, unstaged: 1, untracked: 0, conflicted: 2, insertions: 12, deletions: 3, upstream: 'origin/feat/perfil', ahead: 4, behind: 0, op: 'rebase' },
    commit: { hash: 'c92d4f0', subject: 'feat: profile screen with avatar upload', minutesAgo: 41 },
  },
  {
    // behind the remote, with a stash
    git: { branch: 'main', ...clean, upstream: 'origin/main', ahead: 1, behind: 3, stash: 2 },
    commit: { hash: '03fa7b8', subject: 'chore: bump the charts library', minutesAgo: 190 },
  },
  {
    git: { branch: 'main', ...clean, upstream: 'origin/main', ahead: 0, behind: 0 },
    commit: { hash: 'e5d1a60', subject: 'docs: add the first post', minutesAgo: 1500 },
  },
  {
    // new branch that is not on the remote yet
    git: { branch: 'chore/deps', staged: 0, unstaged: 0, untracked: 4, conflicted: 0, ...SHORTSTAT_NONE },
    commit: { hash: '58b2c77', subject: 'chore: update the pipeline dependencies', minutesAgo: 22 },
  },
  {
    // detached HEAD on a release tag
    git: { head: 'a1b2c3d', detached: true, ...clean },
    commit: { hash: 'a1b2c3d', subject: 'release: v2.3.0', minutesAgo: 4300 },
  },
  {
    // draft pull request, checks still running
    git: { branch: 'feat/whatsapp', staged: 0, unstaged: 2, untracked: 0, conflicted: 0, insertions: 31, deletions: 9, upstream: 'origin/feat/whatsapp', ahead: 3, behind: 0 },
    commit: { hash: '9d70e4b', subject: 'feat: reply to WhatsApp templates', minutesAgo: 8 },
    pr: { number: 31, title: 'WhatsApp channel (draft)', state: 'open', draft: true, checks: checks(2, 0, 3) },
  },
  {
    // merge in progress
    git: { branch: 'main', staged: 3, unstaged: 0, untracked: 0, conflicted: 1, insertions: 40, deletions: 18, upstream: 'origin/main', ahead: 0, behind: 0, op: 'merge' },
    commit: { hash: '1c6e8a3', subject: 'infra: add the database module', minutesAgo: 260 },
  },
  {
    // pull request already merged
    git: { branch: 'fix/hero-mobile', ...clean, upstream: 'origin/fix/hero-mobile', ahead: 1, behind: 0 },
    commit: { hash: 'b30f5d9', subject: 'fix: hero image on small screens', minutesAgo: 600 },
    pr: { number: 58, title: 'Hero image on mobile', state: 'merged', draft: false, review: 'approved', checks: checks(4, 0, 0) },
  },
  {
    // changes requested by a reviewer, checks passing
    git: { branch: 'feat/funil-vendas', staged: 0, unstaged: 5, untracked: 2, conflicted: 0, insertions: 140, deletions: 56, upstream: 'origin/feat/funil-vendas', ahead: 0, behind: 2 },
    commit: { hash: '2f81c0e', subject: 'feat: sales funnel board', minutesAgo: 75 },
    pr: { number: 203, title: 'Sales funnel board', state: 'open', draft: false, review: 'changes-requested', checks: checks(8, 0, 0) },
  },
  {
    git: { branch: 'main', ...clean, upstream: 'origin/main', ahead: 0, behind: 0 },
    commit: { hash: '6aa9d12', subject: 'feat: new level pack', minutesAgo: 3000 },
  },
];

/** Address of the fake pull request (never opened by the demo; the example host cannot be reached). */
function demoUrl(number: number): string {
  return `https://github.com/demo/office/pull/${number}`;
}

/** Git state of the demo project at `index` in the demo catalog (clean `main` for projects outside it). */
export function demoGit(index: number, anchor: number, pullRequests: boolean): ProjectGit {
  const spec = SPECS[index];
  if (spec === undefined) {
    return { branch: 'main', ...clean, upstream: 'origin/main', ahead: 0, behind: 0, stash: 0, lastCommit: { hash: '0d1e2f3', subject: 'chore: initial commit', at: anchor - 2 * 60 * MINUTE_MS } };
  }
  const { pr, commit } = spec;
  return {
    ...spec.git,
    stash: spec.git.stash ?? 0,
    lastCommit: { hash: commit.hash, subject: commit.subject, at: anchor - commit.minutesAgo * MINUTE_MS },
    ...(pr !== undefined && pullRequests ? { pr: { ...pr, url: demoUrl(pr.number), ci: ciOfChecks(pr.checks) } } : {}),
  };
}
