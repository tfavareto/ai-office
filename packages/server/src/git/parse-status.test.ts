import { describe, expect, test } from 'vitest';
import { countStash, parseLastCommit, parseShortstat, parseStatus } from './parse-status';

const OID = '0123456789abcdef0123456789abcdef01234567';

describe('parseStatus', () => {
  test('reads the branch, the upstream and ahead/behind', () => {
    // Arrange
    const output = [
      `# branch.oid ${OID}`,
      '# branch.head feat/cupom',
      '# branch.upstream origin/feat/cupom',
      '# branch.ab +2 -5',
      '',
    ].join('\n');
    // Act
    const status = parseStatus(output);
    // Assert
    expect(status).toMatchObject({
      branch: 'feat/cupom',
      head: '0123456',
      detached: false,
      upstream: 'origin/feat/cupom',
      ahead: 2,
      behind: 5,
    });
  });

  test('has no ahead/behind when the branch tracks nothing', () => {
    const status = parseStatus(`# branch.oid ${OID}\n# branch.head main\n`);
    expect(status.upstream).toBeUndefined();
    expect(status.ahead).toBeUndefined();
    expect(status.behind).toBeUndefined();
  });

  test('recognizes a detached HEAD', () => {
    const status = parseStatus(`# branch.oid ${OID}\n# branch.head (detached)\n`);
    expect(status).toMatchObject({ detached: true, head: '0123456' });
    expect(status.branch).toBeUndefined();
  });

  test('does not invent a commit on a branch that has none yet', () => {
    const status = parseStatus('# branch.oid (initial)\n# branch.head main\n');
    expect(status.head).toBeUndefined();
    expect(status.branch).toBe('main');
  });

  test('counts staged, unstaged, untracked and conflicted files', () => {
    // Arrange: staged only, unstaged only, both, a rename, untracked, ignored, a conflict
    const output = [
      '# branch.head main',
      '1 M. N... 100644 100644 100644 aaa bbb staged-only.ts',
      '1 .M N... 100644 100644 100644 aaa bbb unstaged-only.ts',
      '1 MM N... 100644 100644 100644 aaa bbb both.ts',
      '2 R. N... 100644 100644 100644 aaa bbb R100 new.ts\told.ts',
      '? untracked.txt',
      '? another untracked.txt',
      '! ignored.log',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.ts',
    ].join('\n');
    // Act
    const status = parseStatus(output);
    // Assert
    expect(status).toMatchObject({ staged: 3, unstaged: 2, untracked: 2, conflicted: 1 });
  });

  test('ignores lines it does not know and strips control characters from names', () => {
    const status = parseStatus('garbage\n# branch.head we\u0007ird\n# something.else 1\n');
    expect(status.branch).toBe('weird');
    expect(status).toMatchObject({ staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
  });

  test('limits the length of the branch name', () => {
    const status = parseStatus(`# branch.head ${'x'.repeat(500)}\n`);
    expect(status.branch).toHaveLength(200);
  });
});

describe('parseShortstat', () => {
  test.each([
    [' 3 files changed, 10 insertions(+), 2 deletions(-)\n', { insertions: 10, deletions: 2 }],
    [' 1 file changed, 1 insertion(+)\n', { insertions: 1, deletions: 0 }],
    [' 2 files changed, 4 deletions(-)\n', { insertions: 0, deletions: 4 }],
    ['', { insertions: 0, deletions: 0 }],
  ])('reads %j', (output, expected) => {
    expect(parseShortstat(output)).toEqual(expected);
  });
});

describe('parseLastCommit', () => {
  test('reads hash, time and subject', () => {
    expect(parseLastCommit('a41c9e2\t1760000000\tfeat: apply coupon\n')).toEqual({
      hash: 'a41c9e2',
      at: 1_760_000_000_000,
      subject: 'feat: apply coupon',
    });
  });

  test('keeps tabs that belong to the subject and cuts it', () => {
    const commit = parseLastCommit(`a41c9e2\t1760000000\tfix:\tdo ${'x'.repeat(300)}`);
    expect(commit?.subject.startsWith('fix: do')).toBe(true);
    expect(commit?.subject).toHaveLength(120);
  });

  test.each(['', 'not a commit', 'zz\t1\tsubject', 'abc1234\tNaN\tsubject', 'abc1234\t0\tsubject'])(
    'rejects %j',
    (output) => {
      expect(parseLastCommit(output)).toBeUndefined();
    },
  );
});

describe('countStash', () => {
  test('counts the lines', () => {
    expect(countStash('stash@{0}: WIP on main\nstash@{1}: On x: y\n')).toBe(2);
    expect(countStash('')).toBe(0);
  });
});
