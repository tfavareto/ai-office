import { describe, expect, it } from 'vitest';
import { parseGitSettings, parseProjectGit, safeHref } from './parse-git';
import { parseSnapshot } from './parse';

const valid = {
  branch: 'feat/x',
  staged: 1,
  unstaged: 2,
  untracked: 3,
  conflicted: 0,
  insertions: 10,
  deletions: 4,
  upstream: 'origin/feat/x',
  ahead: 2,
  behind: 1,
  lastCommit: { hash: 'a41c9e2', subject: 'feat: x', at: 1_760_000_000_000 },
  stash: 1,
  op: 'rebase',
  pr: {
    number: 7,
    title: 'Title',
    state: 'open',
    url: 'https://github.com/o/r/pull/7',
    draft: false,
    review: 'approved',
    ci: 'failure',
    checks: { total: 3, passed: 1, failed: 1, pending: 1, failing: ['unit'] },
  },
};

describe('parseProjectGit', () => {
  it('keeps a valid state as it is', () => {
    expect(parseProjectGit(valid)).toEqual(valid);
  });

  it('is nothing for what is not a repository state', () => {
    for (const value of [undefined, null, 5, 'x', [], {}, { branch: '' }])
      expect(parseProjectGit(value)).toBeUndefined();
  });

  it('accepts a detached HEAD with only a commit', () => {
    expect(parseProjectGit({ head: 'a1b2c3d', detached: true })).toMatchObject({
      head: 'a1b2c3d',
      detached: true,
      staged: 0,
      stash: 0,
    });
  });

  it('clamps numbers and drops what is out of range or of another type', () => {
    // Act
    const git = parseProjectGit({
      ...valid,
      staged: -4,
      unstaged: 'many',
      untracked: 1e12,
      insertions: Number.NaN,
      ahead: 'x',
      op: 'explode',
      lastCommit: { hash: '', at: 1 },
    });
    // Assert
    expect(git).toMatchObject({ staged: 0, unstaged: 0, untracked: 1_000_000, insertions: 0 });
    expect(git?.ahead).toBeUndefined();
    expect(git?.behind).toBeUndefined();
    expect(git?.op).toBeUndefined();
    expect(git?.lastCommit).toBeUndefined();
  });

  it('cuts long texts and strips control characters', () => {
    const git = parseProjectGit({
      ...valid,
      branch: `a\u0007${'b'.repeat(500)}`,
      lastCommit: { hash: 'abc1234', subject: `x${'y'.repeat(500)}`, at: 5 },
    });
    expect(git?.branch).toHaveLength(200);
    expect(git?.branch?.includes('\u0007')).toBe(false);
    expect(git?.lastCommit?.subject).toHaveLength(120);
  });

  it('drops a pull request that cannot be shown or linked safely', () => {
    expect(parseProjectGit({ ...valid, pr: { ...valid.pr, url: 'javascript:alert(1)' } })?.pr).toBeUndefined();
    expect(parseProjectGit({ ...valid, pr: { ...valid.pr, state: 'weird' } })?.pr).toBeUndefined();
    expect(parseProjectGit({ ...valid, pr: { ...valid.pr, number: 0 } })?.pr).toBeUndefined();
    expect(parseProjectGit({ ...valid, pr: 'nope' })?.pr).toBeUndefined();
  });

  it('falls back to no checks and no ci for odd pull request fields', () => {
    const pr = parseProjectGit({ ...valid, pr: { ...valid.pr, ci: 'purple', review: 'maybe', checks: 'x' } })?.pr;
    expect(pr).toMatchObject({ ci: 'none', checks: { total: 0, passed: 0, failed: 0, pending: 0 } });
    expect(pr?.review).toBeUndefined();
  });
});

describe('safeHref', () => {
  it('only lets http and https through', () => {
    expect(safeHref('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1');
    expect(safeHref('http://ghe.local/o/r/pull/1')).toBe('http://ghe.local/o/r/pull/1');
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'not a url',
      5,
      undefined,
      `https://x.test/${'a'.repeat(600)}`,
    ])
      expect(safeHref(value)).toBeUndefined();
  });
});

describe('parseGitSettings', () => {
  it('reads the switch and the status of gh', () => {
    expect(parseGitSettings({ pullRequests: true, gh: 'missing' })).toEqual({ pullRequests: true, gh: 'missing' });
    expect(parseGitSettings({ pullRequests: false, gh: 'nonsense' })).toEqual({ pullRequests: false, gh: 'unknown' });
  });

  it('rejects an answer without the switch', () => {
    expect(() => parseGitSettings({})).toThrow();
    expect(() => parseGitSettings(null)).toThrow();
  });
});

describe('parseSnapshot with git', () => {
  const snapshot = (project: Record<string, unknown>, meta: Record<string, unknown> = {}): unknown => ({
    rev: 1,
    serverTime: 1,
    meta: { version: '1', startedAt: 1, local: true, demo: false, ...meta },
    accounts: [],
    projects: [{ id: '/p', name: 'p', path: '/p', seed: 1, order: 0, ...project }],
    agents: [],
    usage: [],
  });

  it('validates the git state of each project and the pull request switch', () => {
    // Act
    const parsed = parseSnapshot(snapshot({ git: { ...valid, staged: -1 } }, { gitPullRequests: true }));
    // Assert
    expect(parsed?.projects[0]?.git).toMatchObject({ branch: 'feat/x', staged: 0 });
    expect(parsed?.meta.gitPullRequests).toBe(true);
  });

  it('leaves the field out when the state is unusable', () => {
    const parsed = parseSnapshot(snapshot({ git: { branch: 5 } }));
    expect(parsed?.projects[0]).not.toHaveProperty('git');
    expect(parsed?.meta).not.toHaveProperty('gitPullRequests');
  });
});
