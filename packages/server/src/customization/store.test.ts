import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { emptyCustomization } from '@ai-office/shared';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { CUSTOMIZATION_FILE, CustomizationStore } from './store';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir();
});
afterEach(async () => {
  await removeDir(dir);
});

const NOW = 1_760_000_000_000;
const make = (onChange?: () => void): CustomizationStore =>
  new CustomizationStore(dir, silentLogger, () => NOW, onChange);
const file = (): string => join(dir, CUSTOMIZATION_FILE);

describe('CustomizationStore', () => {
  test('starts empty when there is no file', async () => {
    const store = make();
    await store.load();
    expect(store.current).toEqual(emptyCustomization());
  });

  test('saves a change atomically with mode 0600 and reads it back', async () => {
    const store = make();
    const result = await store.patch({ agents: { 'a|s': { name: 'Rô', look: { outfit: 'teal' } } }, order: ['/p'] });
    expect(result.ok).toBe(true);
    expect((await stat(file())).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(JSON.parse(await readFile(file(), 'utf8'))).toMatchObject({
      version: 1,
      agents: { 'a|s': { name: 'Rô', look: { outfit: 'teal' } } },
      order: ['/p'],
    });
    const reloaded = make();
    await reloaded.load();
    expect(reloaded.current).toEqual(store.current);
  });

  test('tells its listener after each saved change, a reset included', async () => {
    const onChange = vi.fn();
    const store = make(onChange);
    await store.patch({ rooms: { '/p': { pinned: true } } });
    await store.reset();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(store.current).toEqual(emptyCustomization());
  });

  test('refuses an invalid change and keeps what it had', async () => {
    const store = make();
    await store.patch({ agents: { a: { name: 'Ana' } } });
    const onChange = vi.fn();
    const refused = await make(onChange).patch({ agents: { a: { name: '' } } });
    expect(refused).toMatchObject({ ok: false, status: 400, error: { error: 'invalid-name', field: 'agents.a.name' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(store.current.agents.a?.name).toBe('Ana');
  });

  test('replaces everything with a PUT and refuses a wrong document', async () => {
    const store = make();
    await store.patch({ agents: { a: { name: 'Ana' } } });
    const replaced = await store.replace({
      version: 1,
      agents: {},
      rooms: { '/p': { alias: 'Loja' } },
      accounts: {},
      order: [],
    });
    expect(replaced.ok && replaced.value.agents).toEqual({});
    expect(store.current.rooms['/p']?.alias).toBe('Loja');
    expect(await store.replace({ version: 7 })).toMatchObject({ ok: false, status: 400 });
    expect(store.current.rooms['/p']?.alias).toBe('Loja');
  });

  test('keeps the previous value when the disk refuses', async () => {
    const blocker = join(dir, 'not-a-folder');
    await writeFile(blocker, 'x');
    const store = new CustomizationStore(join(blocker, 'state'), silentLogger, () => NOW);
    const result = await store.patch({ agents: { a: { name: 'Ana' } } });
    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(store.current).toEqual(emptyCustomization());
  });

  test('applies quick consecutive changes in order', async () => {
    const store = make();
    await Promise.all([
      store.patch({ agents: { a: { name: 'Um' } } }),
      store.patch({ agents: { a: { name: 'Dois' } } }),
      store.patch({ agents: { b: { name: 'Três' } } }),
    ]);
    expect(store.current.agents).toEqual({ a: { name: 'Dois' }, b: { name: 'Três' } });
    const reloaded = make();
    await reloaded.load();
    expect(reloaded.current.agents).toEqual(store.current.agents);
  });

  test('migrates a file from before versions and saves it again as version 1', async () => {
    await writeFile(file(), JSON.stringify({ agents: { a: { name: 'Zé' } } }));
    const store = make();
    await store.load();
    expect(store.current.agents.a?.name).toBe('Zé');
    expect(JSON.parse(await readFile(file(), 'utf8'))).toMatchObject({ version: 1, agents: { a: { name: 'Zé' } } });
  });

  test('drops entries it cannot read, keeps the rest and rewrites the file', async () => {
    await writeFile(
      file(),
      JSON.stringify({
        version: 1,
        agents: { good: { name: 'Ana' }, bad: { name: '\u0001' } },
        rooms: {},
        accounts: {},
        order: [],
      }),
    );
    const store = make();
    await store.load();
    expect(Object.keys(store.current.agents)).toEqual(['good']);
    expect(Object.keys(JSON.parse(await readFile(file(), 'utf8')).agents)).toEqual(['good']);
  });

  test.each([
    ['text that is not JSON', '{oops'],
    ['a JSON array', '[]'],
    ['a newer version', JSON.stringify({ version: 9, agents: { a: { name: 'Ana' } } })],
  ])('moves aside a file with %s and starts empty', async (_label, content) => {
    await writeFile(file(), content);
    const store = make();
    await store.load();
    expect(store.current).toEqual(emptyCustomization());
    const names = await readdir(dir);
    expect(names).not.toContain(CUSTOMIZATION_FILE);
    expect(names).toContain(`${CUSTOMIZATION_FILE}.unreadable-${NOW}`);
    expect(await readFile(join(dir, `${CUSTOMIZATION_FILE}.unreadable-${NOW}`), 'utf8')).toBe(content);
  });

  test('does not crash on a file it cannot open', async () => {
    await mkdir(file());
    const store = make();
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.current).toEqual(emptyCustomization());
  });
});
