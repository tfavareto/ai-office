import { describe, expect, test } from 'vitest';
import { PR_FIELDS, lookupPullRequest, parsePullRequest, summarizeChecks } from './pull-request';
import { RunError, type Runner } from './run';

const run = (check: Record<string, unknown>): Record<string, unknown> => ({ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS', name: 'build', ...check });

describe('summarizeChecks', () => {
  test('counts check runs and commit statuses', () => {
    // Arrange
    const rollup = [
      run({ name: 'build' }),
      run({ name: 'lint', conclusion: 'NEUTRAL' }),
      run({ name: 'unit-tests', conclusion: 'FAILURE' }),
      run({ name: 'e2e', status: 'IN_PROGRESS', conclusion: '' }),
      run({ name: 'queued', status: 'QUEUED', conclusion: '' }),
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS' },
      { __typename: 'StatusContext', context: 'ci/deploy', state: 'ERROR' },
      { __typename: 'StatusContext', context: 'ci/wait', state: 'PENDING' },
    ];
    // Act
    const checks = summarizeChecks(rollup);
    // Assert
    expect(checks).toEqual({ total: 8, passed: 3, failed: 2, pending: 3, failing: ['unit-tests', 'ci/deploy'] });
  });

  test('keeps at most three failing names', () => {
    const rollup = ['a', 'b', 'c', 'd'].map((name) => run({ name, conclusion: 'TIMED_OUT' }));
    expect(summarizeChecks(rollup).failing).toEqual(['a', 'b', 'c']);
  });

  test('is empty for anything that is not a list of checks', () => {
    expect(summarizeChecks(null)).toEqual({ total: 0, passed: 0, failed: 0, pending: 0 });
    expect(summarizeChecks([null, 5, 'x', {}])).toEqual({ total: 0, passed: 0, failed: 0, pending: 0 });
  });
});

describe('parsePullRequest', () => {
  const base = { number: 142, title: 'Coupon', state: 'OPEN', url: 'https://github.com/o/r/pull/142', isDraft: false, reviewDecision: 'REVIEW_REQUIRED' };

  test('maps the fields of gh pr view', () => {
    // Arrange
    const output = JSON.stringify({ ...base, statusCheckRollup: [run({}), run({ name: 'unit', conclusion: 'FAILURE' })] });
    // Act
    const pr = parsePullRequest(output);
    // Assert
    expect(pr).toEqual({
      number: 142,
      title: 'Coupon',
      state: 'open',
      url: 'https://github.com/o/r/pull/142',
      draft: false,
      review: 'review-required',
      ci: 'failure',
      checks: { total: 2, passed: 1, failed: 1, pending: 0, failing: ['unit'] },
    });
  });

  test('has no review when nobody decided and no ci when there are no checks', () => {
    const pr = parsePullRequest(JSON.stringify({ ...base, reviewDecision: '', statusCheckRollup: [] }));
    expect(pr?.review).toBeUndefined();
    expect(pr?.ci).toBe('none');
  });

  test.each([
    ['MERGED', 'merged'],
    ['CLOSED', 'closed'],
  ])('reads the %s state', (state, expected) => {
    expect(parsePullRequest(JSON.stringify({ ...base, state }))?.state).toBe(expected);
  });

  test('is pending while a check runs and success when all passed', () => {
    expect(parsePullRequest(JSON.stringify({ ...base, statusCheckRollup: [run({}), run({ status: 'IN_PROGRESS', conclusion: '' })] }))?.ci).toBe('pending');
    expect(parsePullRequest(JSON.stringify({ ...base, statusCheckRollup: [run({})] }))?.ci).toBe('success');
  });

  test.each([
    ['not json', 'nope'],
    ['no number', JSON.stringify({ ...base, number: undefined })],
    ['unknown state', JSON.stringify({ ...base, state: 'DRAFTY' })],
    ['a javascript url', JSON.stringify({ ...base, url: 'javascript:alert(1)' })],
    ['a file url', JSON.stringify({ ...base, url: 'file:///etc/passwd' })],
    ['an array', '[]'],
  ])('rejects %s', (_name, output) => {
    expect(parsePullRequest(output)).toBeUndefined();
  });

  test('cleans the title', () => {
    const pr = parsePullRequest(JSON.stringify({ ...base, title: `Line\none\u0007 ${'x'.repeat(400)}` }));
    expect(pr?.title.startsWith('Line one')).toBe(true);
    expect(pr?.title).toHaveLength(200);
  });
});

describe('lookupPullRequest', () => {
  const fails = (code: string | number, stderr: string): Runner => () => Promise.reject(new RunError('failed', code, stderr, false));

  test('asks gh for exactly the fields we read, in the project folder', async () => {
    // Arrange
    const calls: { file: string; args: readonly string[]; cwd: string }[] = [];
    const runner: Runner = (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      return Promise.resolve(JSON.stringify({ number: 1, title: 't', state: 'OPEN', url: 'https://github.com/o/r/pull/1' }));
    };
    // Act
    const result = await lookupPullRequest(runner, '/work/proj');
    // Assert
    expect(result.status).toBe('found');
    expect(calls).toEqual([{ file: 'gh', args: ['pr', 'view', '--json', PR_FIELDS], cwd: '/work/proj' }]);
  });

  test('says there is no pull request for the branch', async () => {
    expect(await lookupPullRequest(fails(1, 'no pull requests found for branch "x"'), '/p')).toEqual({ status: 'none' });
  });

  test('says gh is missing', async () => {
    expect(await lookupPullRequest(fails('ENOENT', ''), '/p')).toEqual({ status: 'unavailable', gh: 'missing' });
  });

  test('says gh is not signed in', async () => {
    const result = await lookupPullRequest(fails(4, 'To get started with GitHub CLI, please run:  gh auth login'), '/p');
    expect(result).toEqual({ status: 'unavailable', gh: 'unauthenticated' });
  });

  test('treats other failures and unreadable answers as an error', async () => {
    expect(await lookupPullRequest(fails(1, 'boom'), '/p')).toEqual({ status: 'error' });
    expect(await lookupPullRequest(() => Promise.resolve('not json'), '/p')).toEqual({ status: 'error' });
    expect(await lookupPullRequest(() => Promise.reject(new Error('x')), '/p')).toEqual({ status: 'error' });
  });
});
