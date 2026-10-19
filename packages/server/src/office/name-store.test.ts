import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { silentLogger } from '../log';
import { makeTempDir, removeDir } from '../test-helpers';
import { NameStore } from './name-store';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir();
});
afterEach(async () => {
  await removeDir(dir);
});

describe('NameStore', () => {
  test('assigns deterministic names that avoid the ones taken', () => {
    const store = new NameStore(undefined, silentLogger);
    const first = store.assign('claude:s1', new Set());
    expect(new NameStore(undefined, silentLogger).assign('claude:s1', new Set())).toEqual(first);
    const second = store.assign('claude:s2', new Set([first.name]));
    expect(second.name).not.toBe(first.name);
  });

  test('keeps a stored name stable, unless another present agent now uses it', () => {
    const store = new NameStore(undefined, silentLogger);
    const first = store.assign('k', new Set());
    expect(store.assign('k', new Set())).toEqual(first);
    expect(store.assign('k', new Set([first.name])).name).not.toBe(first.name);
  });

  test('persists to names.json and reloads', async () => {
    const store = NameStore.forStateDir(dir, silentLogger);
    const person = store.assign('claude:abc', new Set());
    await store.flush();
    const saved = JSON.parse(await readFile(join(dir, 'names.json'), 'utf8')) as Record<string, string>;
    expect(saved['claude:abc']).toBe(person.name);
    const reloaded = NameStore.forStateDir(dir, silentLogger);
    await reloaded.load();
    expect(reloaded.assign('claude:abc', new Set())).toEqual(person);
  });

  test('survives a corrupt names file', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'names.json'), '{oops');
    const store = NameStore.forStateDir(dir, silentLogger);
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.assign('x', new Set()).name.length).toBeGreaterThan(0);
  });
});
