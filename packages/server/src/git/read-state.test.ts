import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTempDir, removeDir } from '../test-helpers';
import { detectOperation, findGitDir, readGitState } from './read-state';
import { RunError, createGitRunner, type Runner } from './run';

const OID = '0123456789abcdef0123456789abcdef01234567';

interface Call {
  file: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
}

/** A runner that answers by subcommand and records every call. */
function fakeRunner(answers: Record<string, string | Error>): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = (file, args, options) => {
    calls.push({ file, args, cwd: options.cwd, timeoutMs: options.timeoutMs });
    const subcommand = args.find((arg) => ['status', 'diff', 'log', 'stash'].includes(arg)) ?? '';
    const key = subcommand === 'diff' && args.includes('--cached') ? 'diff --cached' : subcommand;
    const answer = answers[key];
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer ?? '');
  };
  return { run, calls };
}

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir('ai-office-git-');
  await mkdir(join(dir, '.git'));
});
afterEach(() => removeDir(dir));

describe('readGitState with a fake runner', () => {
  const status = [
    `# branch.oid ${OID}`,
    '# branch.head feat/x',
    '# branch.upstream origin/feat/x',
    '# branch.ab +1 -2',
    '1 M. N... 1 1 1 a b staged.ts',
    '1 .M N... 1 1 1 a b dirty.ts',
    '? new.ts',
  ].join('\n');

  test('combines status, line counts, last commit and stash', async () => {
    // Arrange
    const { run } = fakeRunner({
      status,
      diff: ' 1 file changed, 5 insertions(+), 1 deletion(-)\n',
      'diff --cached': ' 1 file changed, 3 insertions(+)\n',
      log: 'a41c9e2\t1760000000\tfeat: x\n',
      stash: 'stash@{0}: WIP\n',
    });
    // Act
    const state = await readGitState(run, dir);
    // Assert
    expect(state).toEqual({
      branch: 'feat/x',
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicted: 0,
      insertions: 8,
      deletions: 1,
      upstream: 'origin/feat/x',
      ahead: 1,
      behind: 2,
      lastCommit: { hash: 'a41c9e2', subject: 'feat: x', at: 1_760_000_000_000 },
      stash: 1,
    });
  });

  test('every command is read-only, bounded and run without a shell in the project folder', async () => {
    // Arrange
    const { run, calls } = fakeRunner({
      status,
      diff: ' 1 file changed, 1 insertion(+)\n',
      'diff --cached': ' 1 file changed, 1 insertion(+)\n',
      log: 'a41c9e2\t1760000000\tx\n',
    });
    // Act
    await readGitState(run, dir);
    // Assert
    expect(
      calls.map((call) => call.args.find((arg) => !arg.startsWith('-') && arg !== 'core.fsmonitor=false')),
    ).toEqual(['status', 'diff', 'diff', 'log', 'stash']);
    for (const call of calls) {
      expect(call.file).toBe('git');
      expect(call.cwd).toBe(dir);
      expect(call.timeoutMs).toBe(3000);
      expect(call.args).toContain('--no-optional-locks');
      expect(call.args).toContain('core.fsmonitor=false');
    }
    const writing = [
      'fetch',
      'pull',
      'push',
      'commit',
      'add',
      'checkout',
      'reset',
      'merge',
      'rebase',
      'gc',
      'prune',
      'update-index',
    ];
    for (const call of calls) expect(call.args.some((arg) => writing.includes(arg))).toBe(false);
    for (const call of calls.filter((entry) => entry.args.includes('diff')))
      expect(call.args).toEqual(expect.arrayContaining(['--no-ext-diff', '--no-textconv']));
  });

  test('skips the line counts when nothing is changed in tracked files', async () => {
    // Arrange
    const { run, calls } = fakeRunner({
      status: `# branch.oid ${OID}\n# branch.head main\n? only-untracked.txt\n`,
      log: 'a41c9e2\t1760000000\tx\n',
    });
    // Act
    const state = await readGitState(run, dir);
    // Assert
    expect(state).toMatchObject({ untracked: 1, insertions: 0, deletions: 0, stash: 0 });
    expect(calls.some((call) => call.args.includes('diff'))).toBe(false);
  });

  test('describes a detached HEAD by its commit', async () => {
    const { run } = fakeRunner({ status: `# branch.oid ${OID}\n# branch.head (detached)\n` });
    expect(await readGitState(run, dir)).toMatchObject({ detached: true, head: '0123456' });
  });

  test('keeps going when the extras fail, and fails when status does', async () => {
    // Arrange
    const boom = new RunError('boom', 1, '', false);
    const partial = fakeRunner({ status, diff: boom, 'diff --cached': boom, log: boom, stash: boom });
    const broken = fakeRunner({
      status: new RunError('not a git repository', 128, 'fatal: not a git repository', false),
    });
    // Act + Assert
    expect(await readGitState(partial.run, dir)).toMatchObject({ branch: 'feat/x', insertions: 0, stash: 0 });
    await expect(readGitState(broken.run, dir)).rejects.toBeInstanceOf(RunError);
  });

  test('reports the operation in progress', async () => {
    // Arrange
    await mkdir(join(dir, '.git', 'rebase-merge'));
    const { run } = fakeRunner({ status });
    // Act + Assert
    expect(await readGitState(run, dir)).toMatchObject({ op: 'rebase' });
  });
});

describe('findGitDir and detectOperation', () => {
  test('finds a .git folder, follows a gitdir file and gives up without either', async () => {
    // Arrange
    const worktree = await makeTempDir('ai-office-wt-');
    const plain = await makeTempDir('ai-office-plain-');
    await writeFile(join(worktree, '.git'), `gitdir: ${join(dir, '.git')}\n`);
    // Act + Assert
    expect(await findGitDir(dir)).toBe(join(dir, '.git'));
    expect(await findGitDir(worktree)).toBe(join(dir, '.git'));
    expect(await findGitDir(plain)).toBeUndefined();
    await removeDir(worktree);
    await removeDir(plain);
  });

  test.each([
    ['rebase-merge', 'rebase', true],
    ['rebase-apply', 'rebase', true],
    ['MERGE_HEAD', 'merge', false],
    ['CHERRY_PICK_HEAD', 'cherry-pick', false],
    ['REVERT_HEAD', 'revert', false],
    ['BISECT_LOG', 'bisect', false],
  ])('%s means %s', async (marker, operation, isFolder) => {
    // Arrange
    const gitDir = join(dir, '.git');
    if (isFolder) await mkdir(join(gitDir, marker));
    else await writeFile(join(gitDir, marker), 'x');
    // Act + Assert
    expect(await detectOperation(gitDir)).toBe(operation);
  });

  test('is quiet when nothing is going on', async () => {
    expect(await detectOperation(join(dir, '.git'))).toBeUndefined();
  });
});

describe('readGitState on a real repository created by the test', () => {
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', [...identity, ...args], { cwd, env: environment, encoding: 'utf8' });
  const hasGit = ((): boolean => {
    try {
      execFileSync('git', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  test.skipIf(!hasGit)('reads a clean repository, then its changes', async () => {
    // Arrange: a throw-away repository in a temp folder (never one of the user's)
    const repo = await makeTempDir('ai-office-repo-');
    try {
      git(repo, 'init', '-q', '-b', 'main');
      await writeFile(join(repo, 'a.txt'), 'one\n');
      git(repo, 'add', 'a.txt');
      git(repo, 'commit', '-q', '-m', 'first commit');
      // The production time limit is 3 s; a busy test machine may need longer to start the program.
      const real = createGitRunner({ PATH: process.env.PATH, HOME: repo });
      const run: Runner = (file, args, options) => real(file, args, { ...options, timeoutMs: 60_000 });
      // Act + Assert: clean
      const clean = await readGitState(run, repo);
      expect(clean).toMatchObject({
        branch: 'main',
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        insertions: 0,
        deletions: 0,
        stash: 0,
      });
      expect(clean.lastCommit?.subject).toBe('first commit');
      expect(clean.upstream).toBeUndefined();
      // Act + Assert: one modified, one staged, one untracked
      await writeFile(join(repo, 'a.txt'), 'one\ntwo\n');
      await writeFile(join(repo, 'b.txt'), 'b\n');
      git(repo, 'add', 'b.txt');
      await writeFile(join(repo, 'c.txt'), 'c\n');
      const dirty = await readGitState(run, repo);
      expect(dirty).toMatchObject({ staged: 1, unstaged: 1, untracked: 1, insertions: 2, deletions: 0 });
      // Act + Assert: detached HEAD and a stash
      git(repo, 'stash', 'push', '-q', '-u', '-m', 'wip');
      git(repo, 'checkout', '-q', '--detach');
      const detached = await readGitState(run, repo);
      expect(detached).toMatchObject({ detached: true, stash: 1, staged: 0, unstaged: 0, untracked: 0 });
      expect(detached.branch).toBeUndefined();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
