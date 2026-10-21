import { describe, expect, test } from 'vitest';
import { changedFiles, ciLight, ciOfChecks, gitRef, isDirty, type GitChecks, type ProjectGit } from './git';
import { demoGit } from './demo/git';
import { DEMO_PROJECTS } from './demo/content';
import { createDemoSimulator } from './demo/simulator';

const clean: ProjectGit = {
  branch: 'main',
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  insertions: 0,
  deletions: 0,
  stash: 0,
};
const checks = (passed: number, failed: number, pending: number): GitChecks => ({
  total: passed + failed + pending,
  passed,
  failed,
  pending,
});

describe('changedFiles and isDirty', () => {
  test('add every kind of change', () => {
    expect(changedFiles({ ...clean, staged: 1, unstaged: 2, untracked: 3, conflicted: 4 })).toBe(10);
  });

  test('a clean tree is not dirty, any change makes it dirty', () => {
    expect(isDirty(clean)).toBe(false);
    expect(isDirty({ ...clean, untracked: 1 })).toBe(true);
    expect(isDirty({ ...clean, conflicted: 1 })).toBe(true);
  });
});

describe('gitRef', () => {
  test('is the branch, or the commit when HEAD is detached', () => {
    expect(gitRef(clean)).toBe('main');
    expect(gitRef({ ...clean, branch: undefined, head: 'a1b2c3d', detached: true })).toBe('a1b2c3d');
  });
});

describe('ciOfChecks', () => {
  test.each([
    [checks(0, 0, 0), 'none'],
    [checks(3, 0, 0), 'success'],
    [checks(3, 0, 1), 'pending'],
    [checks(3, 1, 1), 'failure'],
  ] as const)('%j is %s', (input, expected) => {
    expect(ciOfChecks(input)).toBe(expected);
  });
});

describe('ciLight', () => {
  const pr = (state: 'open' | 'merged', ci: 'success' | 'failure'): ProjectGit => ({
    ...clean,
    pr: { number: 1, title: 't', state, url: 'https://x.test/1', draft: false, ci, checks: checks(1, 0, 0) },
  });

  test('lights up for an open pull request only', () => {
    expect(ciLight(pr('open', 'failure'))).toBe('failure');
    expect(ciLight(pr('open', 'success'))).toBe('success');
    expect(ciLight(pr('merged', 'success'))).toBe('none');
    expect(ciLight(clean)).toBe('none');
    expect(ciLight(undefined)).toBe('none');
  });
});

describe('demoGit', () => {
  const anchor = 1_700_000_000_000;

  test('gives every catalog project a state, in a way the snapshot can tell apart', () => {
    const states = DEMO_PROJECTS.map((_project, index) => demoGit(index, anchor, true));
    expect(new Set(states.map((state) => JSON.stringify(state))).size).toBe(DEMO_PROJECTS.length);
    expect(states.some((state) => state.op === 'rebase')).toBe(true);
    expect(states.some((state) => state.op === 'merge')).toBe(true);
    expect(states.some((state) => state.detached === true)).toBe(true);
    expect(states.some((state) => isDirty(state))).toBe(true);
    expect(states.some((state) => !isDirty(state))).toBe(true);
    expect(states.some((state) => (state.ahead ?? 0) > 0)).toBe(true);
    expect(states.some((state) => (state.behind ?? 0) > 0)).toBe(true);
    expect(states.some((state) => ciLight(state) === 'failure')).toBe(true);
    expect(states.some((state) => ciLight(state) === 'success')).toBe(true);
    expect(states.some((state) => ciLight(state) === 'pending')).toBe(true);
  });

  test('has no pull requests when they are off', () => {
    const states = DEMO_PROJECTS.map((_project, index) => demoGit(index, anchor, false));
    expect(states.every((state) => state.pr === undefined)).toBe(true);
  });

  test('is stable for the same anchor and recent relative to it', () => {
    expect(demoGit(0, anchor, true)).toEqual(demoGit(0, anchor, true));
    expect(demoGit(0, anchor, true).lastCommit?.at).toBeLessThan(anchor);
  });

  test('is a clean main for a project outside the catalog', () => {
    expect(demoGit(-1, anchor, true)).toMatchObject({ branch: 'main', staged: 0, ahead: 0 });
  });
});

describe('the demo simulator', () => {
  test('puts the fake git state on its rooms and follows the pull request switch', () => {
    // Arrange
    let pullRequests = true;
    const simulator = createDemoSimulator({
      seed: 1,
      sessions: 4,
      now: () => 1_700_000_000_000,
      pullRequests: () => pullRequests,
    });
    // Act
    const withPr = simulator.projects();
    pullRequests = false;
    const withoutPr = simulator.projects();
    // Assert
    expect(withPr.every((project) => project.git !== undefined)).toBe(true);
    expect(withPr.some((project) => project.git?.pr !== undefined)).toBe(true);
    expect(withoutPr.every((project) => project.git?.pr === undefined)).toBe(true);
  });
});
