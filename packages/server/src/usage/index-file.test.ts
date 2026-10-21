import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { UsageRow } from '@ai-office/shared';
import { makeTempDir, removeDir } from '../test-helpers';
import { type FileState, INDEX_DIR_NAME, type IndexSnapshot, loadIndex, saveIndex } from './index-file';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir('ai-office-indexfile-');
});
afterEach(() => removeDir(dir));

const HOUR = 3_600_000;
const row = (over: Partial<UsageRow> = {}): UsageRow => ({ hour: 500 * HOUR, account: 'a', project: '/p/ünï "q"', model: 'm', session: 's', agent: '', input: 1, output: 2, cacheWrite: 3, cacheRead: 4, costUSD: 0.5, ...over });
const file = (over: Partial<FileState> = {}): FileState => ({ account: 'a', rel: 'projects/x/s.jsonl', session: 's', agent: '', project: '/p', offset: 100, mtimeMs: 1.5e12, ino: 42, head: 7, recent: [], ...over });

function snapshot(over: Partial<IndexSnapshot> = {}): IndexSnapshot {
  const rows = [row(), row({ hour: 501 * HOUR, agent: 'ag', model: 'n' })];
  return { generation: 1, months: new Map([['1970-01', rows]]), emptyMonths: [], rowCounts: new Map([['1970-01', rows.length]]), files: [file()], ...over };
}

describe('saving and loading', () => {
  test('round-trips rows and file states, including odd characters in project paths', async () => {
    // Arrange
    const recent = { id: 'msg_1', hour: 500 * HOUR, model: 'm', input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 5 };
    await saveIndex(dir, snapshot({ files: [file({ recent: [recent] })] }));
    // Act
    const loaded = await loadIndex(dir);
    // Assert
    expect(loaded?.generation).toBe(1);
    expect(loaded?.rows).toEqual([row(), row({ hour: 501 * HOUR, agent: 'ag', model: 'n' })]);
    expect(loaded?.files).toEqual([file({ recent: [recent] })]);
  });

  test('has nothing to load before the first save', async () => {
    expect(await loadIndex(dir)).toBeUndefined();
  });

  test('is written as compact dictionary-coded rows', async () => {
    await saveIndex(dir, snapshot());
    const shard = JSON.parse(await readFile(join(dir, INDEX_DIR_NAME, '1970-01.json'), 'utf8')) as { v: number; p: string[]; rows: unknown[][] };
    expect(shard.v).toBe(1);
    expect(shard.p).toEqual(['/p/ünï "q"']);
    expect(shard.rows[0]).toHaveLength(11);
  });

  test('removes the shard of a month that became empty', async () => {
    await saveIndex(dir, snapshot());
    await saveIndex(dir, snapshot({ generation: 2, months: new Map(), emptyMonths: ['1970-01'], rowCounts: new Map() }));
    expect(await loadIndex(dir)).toMatchObject({ rows: [], generation: 2 });
  });
});

describe('refusing an index it cannot trust', () => {
  test.each([
    ['a different version', async (path: string) => writeFile(path, JSON.stringify({ v: 2, gen: 1, month: '1970-01', rows: [] }))],
    ['rows with missing cells', async (path: string) => writeFile(path, JSON.stringify({ v: 1, gen: 1, month: '1970-01', a: ['a'], p: ['p'], m: ['m'], s: ['s'], g: [''], rows: [[1, 0, 0]] }))],
    ['a shard from a later save than the meta file', async (path: string) => writeFile(path, JSON.stringify({ v: 1, gen: 9, month: '1970-01', a: [], p: [], m: [], s: [], g: [], rows: [] }))],
    ['a shard that lost rows', async (path: string) => writeFile(path, JSON.stringify({ v: 1, gen: 1, month: '1970-01', a: ['a'], p: ['p'], m: ['m'], s: ['s'], g: [''], rows: [] }))],
    ['a shard that is not JSON', async (path: string) => writeFile(path, '<<<')],
  ])('%s', async (_name, damage) => {
    await saveIndex(dir, snapshot());
    await damage(join(dir, INDEX_DIR_NAME, '1970-01.json'));
    expect(await loadIndex(dir)).toBeUndefined();
  });

  test('a listed month whose shard is missing', async () => {
    await saveIndex(dir, snapshot());
    await saveIndex(dir, snapshot({ generation: 2, months: new Map(), emptyMonths: ['1970-01'], rowCounts: new Map([['1970-01', 2]]) }));
    expect(await loadIndex(dir)).toBeUndefined();
  });

  test('a meta file with a malformed file entry', async () => {
    await saveIndex(dir, snapshot());
    const path = join(dir, INDEX_DIR_NAME, 'meta.json');
    const meta = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...meta, files: [{ a: 'x' }] }));
    expect(await loadIndex(dir)).toBeUndefined();
  });
});
