import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTempDir, removeDir } from '../test-helpers';
import { checkFolder, expandHome, normalizeFolderInput } from './folder';

describe('normalizeFolderInput', () => {
  const home = '/home/ana';

  test('accepts absolute paths and normalizes them', () => {
    expect(normalizeFolderInput('/work/app/', home)).toBe('/work/app');
    expect(normalizeFolderInput('/work/app/../lib', home)).toBe('/work/lib');
    expect(normalizeFolderInput('  /work/app  ', home)).toBe('/work/app');
  });

  test('expands a leading ~ to the home folder', () => {
    expect(expandHome('~', home)).toBe(home);
    expect(normalizeFolderInput('~/code/app', home)).toBe('/home/ana/code/app');
    expect(normalizeFolderInput('~other/app', home)).toBeUndefined();
  });

  test.each(['', '   ', 'relative/path', './app', '../app', '/work/a\0b', '/work/a\nb', `/${'x'.repeat(1100)}`])('rejects %j', (input) => {
    expect(normalizeFolderInput(input, home)).toBeUndefined();
  });
});

describe('checkFolder', () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempDir('ai-office-folder-');
  });
  afterEach(async () => removeDir(root));

  test('accepts a readable directory and reports its resolved path', async () => {
    await mkdir(join(root, 'real'));
    await symlink(join(root, 'real'), join(root, 'link'));

    const result = await checkFolder(join(root, 'link'), root);

    expect(result).toMatchObject({ ok: true, path: join(root, 'link') });
    expect(result.ok && result.realPath).toMatch(/real$/);
  });

  test('reports a missing folder', async () => {
    expect(await checkFolder(join(root, 'nope'), root)).toEqual({ ok: false, reason: 'not-found' });
  });

  test('reports a file that is not a directory', async () => {
    await writeFile(join(root, 'file.txt'), 'x');

    expect(await checkFolder(join(root, 'file.txt'), root)).toEqual({ ok: false, reason: 'not-directory' });
  });

  test('reports a relative path as not absolute', async () => {
    expect(await checkFolder('some/dir', root)).toEqual({ ok: false, reason: 'not-absolute' });
  });

  test.skipIf(process.getuid?.() === 0)('reports a directory that cannot be entered', async () => {
    const locked = join(root, 'locked');
    await mkdir(locked);
    await chmod(locked, 0o000);

    try {
      expect(await checkFolder(locked, root)).toEqual({ ok: false, reason: 'not-readable' });
    } finally {
      await chmod(locked, 0o700);
    }
  });
});
