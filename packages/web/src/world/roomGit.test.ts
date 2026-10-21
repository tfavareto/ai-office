import { describe, expect, test } from 'vitest';
import type { ProjectGit } from '@ai-office/shared';
import { fitBranch, pillBranch, plaqueTone, roomGit, roomGitKey } from './roomGit';

const base: ProjectGit = {
  branch: 'main',
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  insertions: 0,
  deletions: 0,
  stash: 0,
};
const pr = (ci: 'success' | 'failure', state: 'open' | 'merged' = 'open'): ProjectGit['pr'] => ({
  number: 1,
  title: 't',
  state,
  url: 'https://x.test/1',
  draft: false,
  ci,
  checks: { total: 1, passed: 1, failed: 0, pending: 0 },
});

describe('roomGit', () => {
  test('is nothing without a repository or without a ref', () => {
    expect(roomGit(undefined)).toBeUndefined();
    expect(roomGit({ ...base, branch: undefined })).toBeUndefined();
  });

  test('summarizes what the plaque needs', () => {
    // Arrange
    const git: ProjectGit = {
      ...base,
      branch: 'feat/x',
      unstaged: 2,
      ahead: 3,
      behind: 1,
      op: 'rebase',
      pr: pr('failure'),
    };
    // Act
    const info = roomGit(git);
    // Assert
    expect(info).toEqual({
      ref: 'feat/x',
      detached: false,
      dirty: true,
      conflicted: false,
      ahead: 3,
      behind: 1,
      op: 'rebase',
      ci: 'failure',
    });
  });

  test('uses the commit on a detached HEAD', () => {
    expect(roomGit({ ...base, branch: undefined, head: 'a1b2c3d', detached: true })).toMatchObject({
      ref: 'a1b2c3d',
      detached: true,
    });
  });

  test('only an open pull request gives a light', () => {
    expect(roomGit({ ...base, pr: pr('success') })?.ci).toBe('success');
    expect(roomGit({ ...base, pr: pr('success', 'merged') })?.ci).toBe('none');
    expect(roomGit(base)?.ci).toBe('none');
  });
});

describe('roomGitKey', () => {
  test('differs whenever something drawn differs', () => {
    const info = roomGit(base);
    const keys = [
      info,
      roomGit({ ...base, branch: 'other' }),
      roomGit({ ...base, untracked: 1 }),
      roomGit({ ...base, conflicted: 1 }),
      roomGit({ ...base, ahead: 1, behind: 0 }),
      roomGit({ ...base, ahead: 0, behind: 1 }),
      roomGit({ ...base, op: 'merge' }),
      roomGit({ ...base, pr: pr('failure') }),
    ].map((value) => roomGitKey(value as NonNullable<typeof value>));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('plaqueTone', () => {
  test.each([
    [base, 'clean'],
    [{ ...base, untracked: 1 }, 'dirty'],
    [{ ...base, op: 'merge' as const }, 'alert'],
    [{ ...base, conflicted: 1 }, 'alert'],
  ])('%j is %s', (git, tone) => {
    expect(plaqueTone(roomGit(git) as NonNullable<ReturnType<typeof roomGit>>)).toBe(tone);
  });
});

describe('pillBranch', () => {
  test('stars a dirty branch and cuts a long one', () => {
    expect(pillBranch(roomGit({ ...base, untracked: 1 }) as NonNullable<ReturnType<typeof roomGit>>)).toBe('main *');
    const long = pillBranch(roomGit({ ...base, branch: 'x'.repeat(60) }) as NonNullable<ReturnType<typeof roomGit>>);
    expect(long).toHaveLength(24);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('fitBranch', () => {
  test('keeps a branch that fits', () => {
    expect(fitBranch('main', 8, '…')).toBe('main');
  });

  test('drops the first segment before cutting', () => {
    expect(fitBranch('feat/cupom', 7, '…')).toBe('cupom');
  });

  test('cuts with the ellipsis when even that does not fit, never past the limit', () => {
    const fitted = fitBranch('feat/a-very-long-branch-name', 9, '…');
    expect(fitted).toBe('a-very-l…');
    expect(fitted.length).toBeLessThanOrEqual(9);
    expect(fitBranch('chore/dependency-updates', 6, '.')).toBe('depen.');
  });

  test('handles degenerate sizes and names', () => {
    expect(fitBranch('main', 0, '…')).toBe('');
    expect(fitBranch('feat/', 3, '…')).toBe('fe…');
    expect(fitBranch('abcdef', 1, '…')).toBe('…');
    expect(fitBranch('abcdef', 2, '...')).toBe('');
  });
});
