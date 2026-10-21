import { describe, expect, test } from 'vitest';
import {
  COMMAND_MAX,
  detectTestRunner,
  displayCommand,
  isGitCommit,
  maskSecrets,
  parseCommits,
  parseTestOutcome,
} from './commands';

describe('maskSecrets', () => {
  test.each([
    ['curl -H "Authorization: Bearer abc.def-123" https://x.test', 'Bearer ***'],
    ['deploy --token abc123 --env prod', '--token ***'],
    ['API_KEY=sk-live-999 node run.js', 'API_KEY=***'],
    ['git clone https://user:hunter2@host.test/repo.git', 'https://user:***@host.test'],
    ['login --password=hunter2', '--password=***'],
  ])('hides the credential in %s', (command, expected) => {
    const masked = maskSecrets(command);
    expect(masked).toContain(expected);
    expect(masked).not.toMatch(/abc\.def|abc123|sk-live|hunter2/);
  });

  test('leaves ordinary commands alone', () => {
    expect(maskSecrets('npm run build -- --watch')).toBe('npm run build -- --watch');
  });
});

describe('displayCommand', () => {
  test('keeps only the first line and cuts long commands', () => {
    expect(displayCommand('\n  git status\ncat <<EOF\nbody\nEOF')).toBe('git status');
    const shown = displayCommand(`echo ${'x'.repeat(400)}`);
    expect(shown.length).toBeLessThanOrEqual(COMMAND_MAX);
    expect(shown.endsWith('…')).toBe(true);
  });
});

describe('detectTestRunner', () => {
  test.each([
    ['npm test', 'npm test'],
    ['pnpm run test:unit -- --watch=false', 'npm test'],
    ['yarn test', 'npm test'],
    ['npx vitest run --project server', 'vitest'],
    ['cd app && npx jest --ci', 'jest'],
    ['python -m pytest -q', 'pytest'],
    ['go test ./...', 'go test'],
    ['cargo test --all', 'cargo test'],
    ['./gradlew test', 'gradle test'],
    ['dotnet test', 'dotnet test'],
  ])('%s is a test run', (command, runner) => {
    expect(detectTestRunner(command)).toBe(runner);
  });

  test.each([
    'grep -r vitest package.json',
    'echo npm test',
    'npm install vitest',
    'git log --grep=jest',
    'npm run build',
  ])('%s is not a test run', (command) => {
    expect(detectTestRunner(command)).toBeUndefined();
  });
});

describe('parseTestOutcome', () => {
  test('reads vitest counts and trusts the last summary line', () => {
    const output = ' Test Files  2 passed (2)\n      Tests  41 passed (41)\n';
    expect(parseTestOutcome(output, false)).toEqual({ outcome: 'passed', passed: 41 });
  });

  test('a failing vitest run reports both counts', () => {
    expect(parseTestOutcome('Tests  2 failed | 39 passed (41)', false)).toEqual({
      outcome: 'failed',
      passed: 39,
      failed: 2,
    });
  });

  test('pytest summary', () => {
    expect(parseTestOutcome('=== 1 failed, 9 passed in 1.20s ===', true)).toEqual({
      outcome: 'failed',
      passed: 9,
      failed: 1,
    });
  });

  test('go test without counts', () => {
    expect(parseTestOutcome('ok  \texample.com/pkg\t0.012s', false).outcome).toBe('passed');
    expect(parseTestOutcome('--- FAIL: TestX (0.00s)\nFAIL\texample.com/pkg', false).outcome).toBe('failed');
  });

  test('cargo test result', () => {
    expect(parseTestOutcome('test result: ok. 12 passed; 0 failed; 0 ignored', false)).toEqual({
      outcome: 'passed',
      passed: 12,
      failed: 0,
    });
  });

  test('a tool error is a failure even without markers', () => {
    expect(parseTestOutcome('Exit code 1\nsomething broke', true).outcome).toBe('failed');
  });

  test('a run left in the background or without output is unknown', () => {
    expect(parseTestOutcome('Command running in background with ID: abc', false).outcome).toBe('unknown');
    expect(parseTestOutcome('', false).outcome).toBe('unknown');
  });

  test('a successful run without markers counts as passed', () => {
    expect(parseTestOutcome('all good', false).outcome).toBe('passed');
  });
});

describe('commits', () => {
  test.each([
    ['git commit -m "feat: x"', true],
    ['git add -A && git commit -m "x"', true],
    ['git -C repo commit --amend', true],
    ['git commit-tree abc', false],
    ['git status', false],
    ['echo commit', false],
  ])('isGitCommit(%s) is %s', (command, expected) => {
    expect(isGitCommit(command)).toBe(expected);
  });

  test('parses the commit lines of the output', () => {
    const output =
      '[main abc1234] feat: add cart\n 2 files changed, 10 insertions(+)\n[feature/x (root-commit) 0f0f0f0] chore: init';
    expect(parseCommits(output)).toEqual([
      { hash: 'abc1234', subject: 'feat: add cart', branch: 'main' },
      { hash: '0f0f0f0', subject: 'chore: init', branch: 'feature/x' },
    ]);
  });

  test('ignores output that is not a commit', () => {
    expect(parseCommits('nothing to commit, working tree clean')).toEqual([]);
  });
});
