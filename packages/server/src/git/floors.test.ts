// These run real git in temporary folders: what matters here is what git actually does to a repository.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTempDir, removeDir } from '../test-helpers';
import { FloorError, createFloor, floorStatus, landFloorByMerge, removeFloor, slugifyFloor } from './floors';
import { createGitRunner } from './run';

const run = createGitRunner();
let root: string;
let repo: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function commitFile(cwd: string, name: string, text: string): Promise<void> {
  await writeFile(join(cwd, name), text);
  git(cwd, 'add', name);
  git(cwd, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-qm', `add ${name}`);
}

beforeEach(async () => {
  root = realpathSync(await makeTempDir('ai-office-floors-'));
  repo = join(root, 'proj');
  await mkdir(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'T');
  git(repo, 'config', 'user.email', 't@example.com');
  await commitFile(repo, 'a.txt', 'a');
});
afterEach(async () => {
  await removeDir(root);
});

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof FloorError) return error.code;
    throw error;
  }
  return 'no-error';
}

describe('slugifyFloor', () => {
  test('makes a safe folder and branch name', () => {
    expect(slugifyFloor('Corrigir o Cupom!')).toBe('corrigir-o-cupom');
    expect(slugifyFloor('ação rápida')).toBe('acao-rapida');
  });

  test('refuses what has no usable name, or tries to leave the folder', () => {
    expect(slugifyFloor('!!!')).toBeNull();
    expect(slugifyFloor('../../etc')).toBe('etc');
    expect(slugifyFloor('-x')).toBe('x');
  });
});

describe('createFloor', () => {
  test('creates a checkout next to the repository, on a new branch, and leaves the repository alone', async () => {
    // Act
    const floor = await createFloor(run, repo, 'Corrigir cupom');

    // Assert
    expect(floor.path).toBe(join(root, 'proj-floors', 'corrigir-cupom'));
    expect(floor.branch).toBe('floor/corrigir-cupom');
    expect(existsSync(join(floor.path, 'a.txt'))).toBe(true);
    expect(git(floor.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('floor/corrigir-cupom');
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('a second floor with the name of one that has work is refused', async () => {
    // Arrange and act
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');
    expect(await failure(createFloor(run, repo, 'x'))).toBe('floor-exists');
  });

  test('a folder that is not a repository is refused', async () => {
    // Arrange
    const plain = join(root, 'plain');
    await mkdir(plain);

    // Act and assert
    expect(await failure(createFloor(run, plain, 'x'))).toBe('not-a-repository');
  });

  test('a name with nothing usable is refused', async () => {
    expect(await failure(createFloor(run, repo, '!!!'))).toBe('invalid-name');
  });

  test("does not run the repository's hooks", async () => {
    // Arrange
    const marker = join(root, 'hook-ran');
    await writeFile(join(repo, '.git/hooks/post-checkout'), `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });

    // Act
    await createFloor(run, repo, 'x');

    // Assert
    expect(existsSync(marker)).toBe(false);
  });
});

describe('createFloor, in rooms that cannot have floors', () => {
  test('a floor cannot have floors of its own', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');

    // Act and assert
    expect(await failure(createFloor(run, floor.path, 'y'))).toBe('not-a-repository');
  });

  test('creating the same name again reuses a floor that is still empty, so a failed hire can be retried', async () => {
    // Arrange
    const first = await createFloor(run, repo, 'x');

    // Act
    const second = await createFloor(run, repo, 'x');

    // Assert
    expect(second).toEqual(first);
  });

  test('a repository whose own configuration could run a program is refused', async () => {
    // Arrange: an agent, or something that fooled one, can write this file.
    git(repo, 'config', '--local', 'filter.evil.smudge', 'touch /tmp/evil');

    // Act and assert
    expect(await failure(createFloor(run, repo, 'x'))).toBe('unsafe-config');
  });
});

describe('floorStatus', () => {
  test('a repository itself is not a floor', async () => {
    expect((await floorStatus(run, repo)).isFloor).toBe(false);
  });

  test('another worktree the person made is not a floor, so it is never touched', async () => {
    // Arrange
    const other = join(root, 'elsewhere');
    git(repo, 'worktree', 'add', '-q', '-b', 'mine', other);

    // Act and assert
    expect((await floorStatus(run, other)).isFloor).toBe(false);
  });

  test('says the branch, where it lands, how far ahead it is and if there is unsaved work', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');
    await writeFile(join(floor.path, 'c.txt'), 'unsaved');

    // Act
    const status = await floorStatus(run, floor.path);

    // Assert
    expect(status).toMatchObject({ isFloor: true, branch: 'floor/x', target: 'main', ahead: 1, dirty: true });
  });

  test('a folder that is not a repository is not a floor', async () => {
    // Arrange
    const plain = join(root, 'plain');
    await mkdir(plain);

    // Act and assert
    expect((await floorStatus(run, plain)).isFloor).toBe(false);
  });
});

describe('landing by merge', () => {
  test('brings the work to the repository', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');

    // Act
    await landFloorByMerge(run, floor.path);

    // Assert
    expect(existsSync(join(repo, 'b.txt'))).toBe(true);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('refuses unsaved work in the floor', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');
    await writeFile(join(floor.path, 'c.txt'), 'unsaved');

    // Act and assert
    expect(await failure(landFloorByMerge(run, floor.path))).toBe('floor-dirty');
    expect(existsSync(join(repo, 'b.txt'))).toBe(false);
  });

  test('refuses unsaved work in the repository, which a merge could overwrite', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');
    await writeFile(join(repo, 'a.txt'), 'edited, not saved');

    // Act and assert
    expect(await failure(landFloorByMerge(run, floor.path))).toBe('target-dirty');
    expect(existsSync(join(repo, 'b.txt'))).toBe(false);
  });

  test('says when there is nothing to land', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');

    // Act and assert
    expect(await failure(landFloorByMerge(run, floor.path))).toBe('nothing-to-land');
  });

  test('a conflict leaves the repository as it was and names the files', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'a.txt', 'from the floor');
    await commitFile(repo, 'a.txt', 'from main');
    const before = git(repo, 'rev-parse', 'HEAD');

    // Act
    let conflict: FloorError | undefined;
    await landFloorByMerge(run, floor.path).catch((error: FloorError) => {
      conflict = error;
    });

    // Assert
    expect(conflict?.code).toBe('floor-conflict');
    expect(conflict?.files).toEqual(['a.txt']);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('a folder that is not a floor is refused', async () => {
    expect(await failure(landFloorByMerge(run, repo))).toBe('not-a-floor');
  });
});

describe('a floor or repository not on a branch', () => {
  test('landing is refused and nothing is reported as merged', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');
    git(floor.path, 'checkout', '-q', '--detach');

    // Act and assert
    expect(await failure(landFloorByMerge(run, floor.path))).toBe('floor-detached');
    expect(existsSync(join(repo, 'b.txt'))).toBe(false);
  });

  test('removing is refused, because its commits would be lost', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    git(floor.path, 'checkout', '-q', '--detach');
    await commitFile(floor.path, 'b.txt', 'b');

    // Act and assert
    expect(await failure(removeFloor(run, floor.path))).toBe('floor-detached');
    expect(existsSync(join(floor.path, 'b.txt'))).toBe(true);
  });

  test('landing onto a repository not on a branch is refused', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');
    git(repo, 'checkout', '-q', '--detach');

    // Act and assert
    expect(await failure(landFloorByMerge(run, floor.path))).toBe('floor-detached');
  });

  test('the status says so', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    git(floor.path, 'checkout', '-q', '--detach');

    // Act and assert
    expect(await floorStatus(run, floor.path)).toMatchObject({ isFloor: true, detached: true });
  });
});

describe('work a plain status would miss', () => {
  test('untracked files count even if the configuration hides them', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    git(repo, 'config', 'status.showUntrackedFiles', 'no');
    await writeFile(join(floor.path, 'u.txt'), 'unsaved');

    // Act and assert
    expect(await failure(removeFloor(run, floor.path))).toBe('floor-dirty');
    expect(existsSync(join(floor.path, 'u.txt'))).toBe(true);
  });

  test('ignored files stop a removal until the person accepts losing them', async () => {
    // Arrange
    await commitFile(repo, '.gitignore', '.env\n');
    const floor = await createFloor(run, repo, 'x');
    await writeFile(join(floor.path, '.env'), 'SECRET=1');

    // Act
    const refused = await failure(removeFloor(run, floor.path));
    const stillThere = existsSync(join(floor.path, '.env'));
    await removeFloor(run, floor.path, { acceptIgnored: true });

    // Assert
    expect(refused).toBe('floor-has-ignored');
    expect(stillThere).toBe(true);
    expect(existsSync(floor.path)).toBe(false);
  });
});

describe('a merge already going on in the repository', () => {
  test('is left alone', async () => {
    // Arrange: a merge the person is in the middle of.
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');
    git(repo, 'branch', 'other');
    git(repo, 'checkout', '-q', 'other');
    await commitFile(repo, 'c.txt', 'c');
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'merge', '--no-commit', '--no-ff', '-q', 'other');

    // Act
    const code = await failure(landFloorByMerge(run, floor.path));

    // Assert
    expect(['target-dirty', 'target-busy']).toContain(code);
    expect(git(repo, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')).not.toBe('');
  });
});

describe('removing a floor', () => {
  test('removes the folder and a branch that was already landed', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');
    await landFloorByMerge(run, floor.path);

    // Act
    const result = await removeFloor(run, floor.path);

    // Assert
    expect(existsSync(floor.path)).toBe(false);
    expect(result.branchKept).toBe(false);
    expect(git(repo, 'branch', '--list', 'floor/x')).toBe('');
  });

  test('keeps a branch that has work not landed yet', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await commitFile(floor.path, 'b.txt', 'b');

    // Act
    const result = await removeFloor(run, floor.path);

    // Assert
    expect(existsSync(floor.path)).toBe(false);
    expect(result.branchKept).toBe(true);
    expect(git(repo, 'branch', '--list', 'floor/x')).toContain('floor/x');
  });

  test('refuses unsaved work, and removes nothing', async () => {
    // Arrange
    const floor = await createFloor(run, repo, 'x');
    await writeFile(join(floor.path, 'c.txt'), 'unsaved');

    // Act and assert
    expect(await failure(removeFloor(run, floor.path))).toBe('floor-dirty');
    expect(existsSync(join(floor.path, 'c.txt'))).toBe(true);
  });

  test('a folder that is not a floor is refused, and removes nothing', async () => {
    // Act
    const code = await failure(removeFloor(run, repo));

    // Assert
    expect(code).toBe('not-a-floor');
    expect(existsSync(join(repo, 'a.txt'))).toBe(true);
    expect(basename(dirname(repo))).toBe(basename(root));
  });
});
