import { describe, expect, it } from 'vitest';
import type { GitPullRequest, ProjectGit } from '@ai-office/shared';
import { branchChip, changeCounts, checksView, lineChanges, prBadgeState, syncState } from './git';

const clean: ProjectGit = { branch: 'main', staged: 0, unstaged: 0, untracked: 0, conflicted: 0, insertions: 0, deletions: 0, stash: 0 };
const pr = (patch: Partial<GitPullRequest>): GitPullRequest => ({
  number: 1, title: 't', state: 'open', url: 'https://x.test/1', draft: false, ci: 'success', checks: { total: 1, passed: 1, failed: 0, pending: 0 }, ...patch,
});

describe('changeCounts', () => {
  it('lists only the kinds that have files, conflicts first', () => {
    expect(changeCounts({ ...clean, staged: 2, untracked: 1, conflicted: 3 })).toEqual([
      { kind: 'conflicted', n: 3 },
      { kind: 'staged', n: 2 },
      { kind: 'untracked', n: 1 },
    ]);
  });

  it('is empty for a clean tree', () => {
    expect(changeCounts(clean)).toEqual([]);
  });
});

describe('lineChanges', () => {
  it('says nothing without changed lines', () => {
    expect(lineChanges(clean)).toBeNull();
    expect(lineChanges({ ...clean, insertions: 4, deletions: 1 })).toEqual({ insertions: 4, deletions: 1 });
  });
});

describe('syncState', () => {
  it('has no upstream for a local branch', () => {
    expect(syncState(clean)).toEqual({ kind: 'no-upstream' });
  });

  it('is in sync when nothing is ahead or behind', () => {
    expect(syncState({ ...clean, upstream: 'origin/main', ahead: 0, behind: 0 })).toEqual({ kind: 'in-sync', upstream: 'origin/main' });
  });

  it('reports ahead and behind', () => {
    expect(syncState({ ...clean, upstream: 'origin/main', ahead: 2, behind: 5 })).toEqual({ kind: 'diverged', upstream: 'origin/main', ahead: 2, behind: 5 });
  });
});

describe('checksView', () => {
  it('lists the failing names and counts the ones that did not travel', () => {
    expect(checksView({ total: 9, passed: 5, failed: 4, pending: 0, failing: ['a', 'b', 'c'] })).toEqual({ total: 9, passed: 5, failing: ['a', 'b', 'c'], moreFailing: 1, pending: 0 });
  });

  it('copes with no names', () => {
    expect(checksView({ total: 2, passed: 1, failed: 1, pending: 0 })).toMatchObject({ failing: [], moreFailing: 1 });
  });
});

describe('prBadgeState', () => {
  it('turns an open draft into a draft', () => {
    expect(prBadgeState(pr({ draft: true }))).toBe('draft');
    expect(prBadgeState(pr({}))).toBe('open');
    expect(prBadgeState(pr({ state: 'merged', draft: true }))).toBe('merged');
  });
});

describe('branchChip', () => {
  it('is nothing without a repository', () => {
    expect(branchChip(undefined)).toBeNull();
  });

  it('shows the branch, and whether it is dirty or in the middle of something', () => {
    expect(branchChip({ ...clean, branch: 'feat/x', unstaged: 1, op: 'rebase' })).toEqual({ label: 'feat/x', dirty: true, op: 'rebase', detached: false });
  });

  it('shows the commit of a detached HEAD', () => {
    expect(branchChip({ ...clean, branch: undefined, head: 'a1b2c3d', detached: true })).toMatchObject({ label: 'a1b2c3d', detached: true });
  });
});
