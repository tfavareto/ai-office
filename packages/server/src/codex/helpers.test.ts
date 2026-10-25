import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { MAX_COMMAND_CHARS, commandText } from './command-text';
import { type FakeCodexHome, THREAD, makeFakeCodex, sessionMeta, userMessage } from './fixtures';
import { codexAccounts, codexDirs } from './home';
import { countDiffLines, countLines, parsePatch } from './patch';
import { readRecord } from './record';
import { CodexSettingsStore } from './settings-store';
import { readThreadNames } from './thread-names';

describe('commandText', () => {
  test.each([
    [['bash', '-lc', 'npm test && npm run lint'], 'npm test && npm run lint'],
    [['/bin/zsh', '-c', 'ls'], 'ls'],
    [['git', 'commit', '-m', 'a message'], "git commit -m 'a message'"],
    [['echo', "it's"], "echo 'it'\\''s'"],
    ['ls -la', 'ls -la'],
  ])('%j -> %s', (command, expected) => {
    expect(commandText(command)).toBe(expected);
  });

  test.each([[undefined], [[]], [[1, 2]], [{ a: 1 }], [null]])('%j has no text', (command) => {
    expect(commandText(command)).toBeUndefined();
  });

  test('long commands are cut', () => {
    expect(commandText('x'.repeat(MAX_COMMAND_CHARS * 2))?.length).toBe(MAX_COMMAND_CHARS);
  });
});

describe('patches', () => {
  test('lists the files with their line counts', () => {
    const files = parsePatch(
      [
        '*** Begin Patch',
        '*** Add File: a.txt',
        '+one',
        '+two',
        '*** Update File: b.txt',
        '*** Move to: c.txt',
        '@@ context',
        ' same',
        '-gone',
        '+new',
        '*** Delete File: d.txt',
        '-would not count',
        '*** End Patch',
      ].join('\n'),
    );
    expect(files).toEqual([
      { op: 'add', path: 'a.txt', added: 2, removed: 0 },
      { op: 'update', path: 'b.txt', added: 1, removed: 1 },
      { op: 'delete', path: 'd.txt', added: 0, removed: 0 },
    ]);
  });

  test('text that is not a patch has no files', () => {
    expect(parsePatch('hello\n+not a patch')).toEqual([]);
    expect(parsePatch('')).toEqual([]);
  });

  test('counts the lines of a unified diff and of a content', () => {
    expect(countDiffLines('--- a\n+++ b\n@@ -1 +1,2 @@\n-x\n+y\n+z\n context')).toEqual({ added: 2, removed: 1 });
    expect(countLines('')).toBe(0);
    expect(countLines('a\nb')).toBe(2);
  });
});

describe('readRecord', () => {
  test('reads the envelope', () => {
    const record = readRecord(userMessage('oi', 0));
    expect(record).toMatchObject({ type: 'event_msg', payload: { type: 'user_message', message: 'oi' } });
    expect(record?.at).toBeGreaterThan(0);
  });

  test('a non-object payload becomes an empty one', () => {
    expect(readRecord('{"timestamp":"2026-10-19T12:00:00.000Z","type":"x","payload":[1]}')).toMatchObject({
      payload: {},
    });
  });
});

describe('Codex homes', () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempDir('ai-office-homes-');
  });
  afterEach(() => removeDir(root));

  test('CODEX_HOME wins over ~/.codex and the extra folders are added', () => {
    expect(codexDirs({ homeDir: '/h', envDir: undefined, extraDirs: [] })).toEqual(['/h/.codex']);
    expect(codexDirs({ homeDir: '/h', envDir: '/custom', extraDirs: ['/x', '/custom'] })).toEqual(['/custom', '/x']);
    expect(codexDirs({ homeDir: '/h', envDir: '', extraDirs: [] })).toEqual(['/h/.codex']);
  });

  test('only the folders that exist become accounts; the first is "codex"', async () => {
    const main = join(root, '.codex');
    const work = join(root, '.codex-work');
    await mkdir(main);
    await mkdir(work);
    const accounts = codexAccounts([main, join(root, 'missing'), work]);
    expect(accounts).toMatchObject([
      { id: 'codex', label: 'Codex', initial: 'C', dir: main, source: 'codex' },
      { id: 'codex-codex-work', label: 'Codex codex-work', dir: work, source: 'codex' },
    ]);
    expect(codexAccounts([join(root, 'missing')])).toEqual([]);
  });

  test('two folders with the same name do not share an id', async () => {
    await mkdir(join(root, 'a', 'codex'), { recursive: true });
    await mkdir(join(root, 'b', 'codex'), { recursive: true });
    const [, second, third] = codexAccounts([root, join(root, 'a', 'codex'), join(root, 'b', 'codex')]);
    expect(second?.id).not.toBe(third?.id);
  });
});

describe('thread names', () => {
  let fake: FakeCodexHome;
  beforeEach(async () => {
    fake = await makeFakeCodex();
  });
  afterEach(() => fake.cleanup());

  test('reads the last name of each thread and skips damaged lines', async () => {
    await writeFile(
      join(fake.dir, 'session_index.jsonl'),
      [
        JSON.stringify({ id: THREAD, thread_name: 'First name', updated_at: 'x' }),
        'garbage',
        JSON.stringify({ id: 'other', thread_name: '   ' }),
        JSON.stringify({ id: THREAD, thread_name: 'Renamed', updated_at: 'y' }),
        '{"id":"half',
      ].join('\n'),
    );
    expect(await readThreadNames(fake.dir)).toEqual(new Map([[THREAD, 'Renamed']]));
  });

  test('no index means no names', async () => {
    expect((await readThreadNames(fake.dir)).size).toBe(0);
  });
});

describe('CodexSettingsStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await makeTempDir('ai-office-settings-');
  });
  afterEach(() => removeDir(dir));

  test('is on by default and remembers the choice', async () => {
    const store = new CodexSettingsStore(dir, silentLogger);
    await store.load();
    expect(store.sessions).toBe(true);
    expect(await store.setSessions(false)).toBe(true);
    expect(store.sessions).toBe(false);
    const again = new CodexSettingsStore(dir, silentLogger);
    await again.load();
    expect(again.sessions).toBe(false);
  });

  test('an environment that turned Codex off wins', async () => {
    const store = new CodexSettingsStore(dir, silentLogger, true);
    await store.load();
    expect(store.sessions).toBe(false);
    expect(store.locked).toBe(true);
  });

  test('a damaged file means on', async () => {
    await writeFile(join(dir, 'codex-settings.json'), 'not json');
    const store = new CodexSettingsStore(dir, silentLogger);
    await store.load();
    expect(store.sessions).toBe(true);
  });

  test('keeps the previous value when the disk refuses', async () => {
    const store = new CodexSettingsStore(join(dir, 'file-not-dir', 'x'), silentLogger);
    await writeFile(join(dir, 'file-not-dir'), 'x');
    expect(await store.setSessions(false)).toBe(false);
    expect(store.sessions).toBe(true);
  });
});

test('fixtures carry a session_meta that names the thread', () => {
  expect(readRecord(sessionMeta(0))?.payload.id).toBe(THREAD);
});
