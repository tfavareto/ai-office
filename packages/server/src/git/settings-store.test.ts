import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { GIT_SETTINGS_FILE, GitSettingsStore } from './settings-store';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir('ai-office-gitset-');
});
afterEach(() => removeDir(dir));

describe('GitSettingsStore', () => {
  test('pull requests are off by default', async () => {
    const store = new GitSettingsStore(dir, silentLogger);
    await store.load();
    expect(store.pullRequests).toBe(false);
  });

  test('keeps the choice across restarts, in a private file', async () => {
    // Arrange
    const first = new GitSettingsStore(dir, silentLogger);
    // Act
    expect(await first.setPullRequests(true)).toBe(true);
    const second = new GitSettingsStore(dir, silentLogger);
    await second.load();
    // Assert
    expect(second.pullRequests).toBe(true);
    expect(((await stat(join(dir, GIT_SETTINGS_FILE))).mode & 0o777).toString(8)).toBe('600');
  });

  test.each(['not json', '{"version":2,"pullRequests":true}', '{"version":1,"pullRequests":"yes"}', '[]'])(
    'falls back to off for %s',
    async (content) => {
      await writeFile(join(dir, GIT_SETTINGS_FILE), content);
      const store = new GitSettingsStore(dir, silentLogger);
      await store.load();
      expect(store.pullRequests).toBe(false);
    },
  );

  test('keeps the previous value when the disk refuses', async () => {
    // Arrange: the state folder is a file, so nothing can be written under it
    const blocked = join(dir, 'blocked');
    await writeFile(blocked, 'x');
    const store = new GitSettingsStore(join(blocked, 'state'), silentLogger);
    // Act
    const saved = await store.setPullRequests(true);
    // Assert
    expect(saved).toBe(false);
    expect(store.pullRequests).toBe(false);
  });

  test('writes the documented shape', async () => {
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o700);
    const store = new GitSettingsStore(dir, silentLogger);
    await store.setPullRequests(true);
    expect(JSON.parse(await readFile(join(dir, GIT_SETTINGS_FILE), 'utf8'))).toEqual({
      version: 1,
      pullRequests: true,
    });
  });
});
