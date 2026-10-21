import { describe, expect, it } from 'vitest';
import { commandSegments, foldCommand, isSimpleCommand, matchesPrefixAnywhere, matchesPrefixStrict } from './command';

describe('isSimpleCommand', () => {
  it.each(['npm test', 'npm test -- --watch', 'git status', 'ls -la src', 'npm run build --workspace=web'])(
    'accepts %s',
    (command) => {
      expect(isSimpleCommand(command)).toBe(true);
    },
  );

  it.each([
    ['npm test; rm -rf /'],
    ['npm test && rm -rf /'],
    ['npm test || echo fail'],
    ['npm test | tee out.log'],
    ['npm test & disown'],
    ['echo `whoami`'],
    ['echo $(whoami)'],
    ['npm test > out.log'],
    ['npm test 2>&1'],
    ['cat < /etc/passwd'],
    ['npm test\nrm -rf /'],
    ['(cd src && npm test)'],
    [''],
  ])('rejects %j', (command) => {
    expect(isSimpleCommand(command)).toBe(false);
  });

  it('rejects chaining hidden inside quotes (the check ignores quoting on purpose)', () => {
    expect(isSimpleCommand('npm test -- --grep "a; b"')).toBe(false);
  });
});

describe('matchesPrefixStrict', () => {
  it('matches whole words, with any arguments after them', () => {
    expect(matchesPrefixStrict('npm test', 'npm test')).toBe(true);
    expect(matchesPrefixStrict('npm test -- --watch', 'npm test')).toBe(true);
    expect(matchesPrefixStrict('  npm   test  ', 'npm test')).toBe(true);
  });

  it('does not match a longer word or another command', () => {
    expect(matchesPrefixStrict('npm testx', 'npm test')).toBe(false);
    expect(matchesPrefixStrict('npm tes', 'npm test')).toBe(false);
    expect(matchesPrefixStrict('pnpm test', 'npm test')).toBe(false);
    expect(matchesPrefixStrict('npm', 'npm test')).toBe(false);
    expect(matchesPrefixStrict('FOO=1 npm test', 'npm test')).toBe(false);
  });

  it('does not match compound commands', () => {
    expect(matchesPrefixStrict('npm test; rm -rf /', 'npm test')).toBe(false);
    expect(matchesPrefixStrict('npm test && git push', 'npm test')).toBe(false);
    expect(matchesPrefixStrict('npm test $(rm -rf /)', 'npm test')).toBe(false);
  });
});

describe('matchesPrefixAnywhere', () => {
  it('finds the prefix in any simple command of a compound one', () => {
    expect(matchesPrefixAnywhere('npm test && git push origin main', 'git push')).toBe(true);
    expect(matchesPrefixAnywhere('ls; rm -rf dist', 'rm')).toBe(true);
    expect(matchesPrefixAnywhere('echo $(rm -rf x)', 'rm')).toBe(true);
    expect(matchesPrefixAnywhere('cat a | sh', 'sh')).toBe(true);
  });

  it('looks through wrappers and assignments', () => {
    expect(matchesPrefixAnywhere('sudo rm -rf /tmp/x', 'rm')).toBe(true);
    expect(matchesPrefixAnywhere('FOO=1 BAR=2 rm x', 'rm')).toBe(true);
    expect(matchesPrefixAnywhere('env -i nohup rm x', 'rm')).toBe(true);
  });

  it('does not match a different word', () => {
    expect(matchesPrefixAnywhere('npm run rmdir', 'rm')).toBe(false);
    expect(matchesPrefixAnywhere('git pushd', 'git push')).toBe(false);
  });
});

describe('commandSegments and foldCommand', () => {
  it('splits at every chaining operator', () => {
    expect(commandSegments('a && b || c; d | e & f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('folds whitespace', () => {
    expect(foldCommand('  npm \t test\n')).toBe('npm test');
  });
});
