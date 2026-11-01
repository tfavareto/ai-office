import { describe, expect, test } from 'vitest';
import { MAX_PROJECT_FILES, listProjectFiles, parseFileList } from './project-files';
import { RunError, type Runner } from './run';

describe('parseFileList', () => {
  test('splits the NUL-separated output, sorted and without duplicates', () => {
    // Arrange
    const output = 'src/b.ts\0src/a.ts\0src/a.ts\0';

    // Act
    const list = parseFileList(output);

    // Assert
    expect(list).toEqual({ files: ['src/a.ts', 'src/b.ts'], truncated: false });
  });

  test('keeps paths with spaces and new lines whole', () => {
    // Arrange
    const output = 'a file.ts\0b\nc.ts\0';

    // Act
    const list = parseFileList(output);

    // Assert
    expect(list.files).toEqual(['a file.ts', 'b\nc.ts']);
  });

  test('says when it cut the list', () => {
    // Arrange
    const output = Array.from({ length: MAX_PROJECT_FILES + 1 }, (_, index) => `f${index}.ts`).join('\0');

    // Act
    const list = parseFileList(output);

    // Assert
    expect(list.files).toHaveLength(MAX_PROJECT_FILES);
    expect(list.truncated).toBe(true);
  });
});

describe('listProjectFiles', () => {
  test('asks git for tracked and untracked files that are not ignored, in the project folder', async () => {
    // Arrange
    const calls: { args: readonly string[]; cwd: string }[] = [];
    const run: Runner = (_file, args, options) => {
      calls.push({ args, cwd: options.cwd });
      return Promise.resolve('a.ts\0');
    };

    // Act
    const list = await listProjectFiles(run, '/work/proj');

    // Assert
    expect(list.files).toEqual(['a.ts']);
    expect(calls[0]?.cwd).toBe('/work/proj');
    expect(calls[0]?.args).toEqual([
      '--no-pager',
      '--no-optional-locks',
      '-c',
      'core.fsmonitor=false',
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
  });

  test('a folder that is not a repository has no files to offer', async () => {
    // Arrange
    const run: Runner = () => Promise.reject(new RunError('not a git repository', 128, 'fatal', false));

    // Act
    const list = await listProjectFiles(run, '/work/plain');

    // Assert
    expect(list).toEqual({ files: [], truncated: false });
  });

  test('a list too large for the output limit comes back empty and marked as cut', async () => {
    // Arrange
    const run: Runner = () =>
      Promise.reject(new RunError('stdout maxBuffer length exceeded', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', '', false));

    // Act
    const list = await listProjectFiles(run, '/work/huge');

    // Assert
    expect(list).toEqual({ files: [], truncated: true });
  });
});
