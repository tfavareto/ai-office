import { appendFile, rename, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeTempDir, removeDir } from '../test-helpers';
import { JsonlTailer } from './jsonl-tailer';

let dir: string;
beforeEach(async () => {
  dir = await makeTempDir();
});
afterEach(async () => {
  await removeDir(dir);
});

describe('JsonlTailer', () => {
  test('returns undefined while the file does not exist', async () => {
    expect(await new JsonlTailer(join(dir, 'nada.jsonl')).read()).toBeUndefined();
  });

  test('reads complete lines incrementally', async () => {
    const path = join(dir, 'a.jsonl');
    await writeFile(path, '{"a":1}\n{"a":2}\n');
    const tailer = new JsonlTailer(path);
    expect((await tailer.read())?.lines).toEqual(['{"a":1}', '{"a":2}']);
    await appendFile(path, '{"a":3}\n');
    const second = await tailer.read();
    expect(second).toMatchObject({ lines: ['{"a":3}'], initial: false, reset: false });
    expect((await tailer.read())?.lines).toEqual([]);
  });

  test('holds a partial last line until its newline arrives', async () => {
    const path = join(dir, 'p.jsonl');
    await writeFile(path, '{"a":1}\n{"a":');
    const tailer = new JsonlTailer(path);
    expect((await tailer.read())?.lines).toEqual(['{"a":1}']);
    await appendFile(path, '2}\n');
    expect((await tailer.read())?.lines).toEqual(['{"a":2}']);
  });

  test('handles multi-byte characters split across reads', async () => {
    const path = join(dir, 'u.jsonl');
    const line = Buffer.from('{"t":"ação"}\n');
    await writeFile(path, line.subarray(0, 8));
    const tailer = new JsonlTailer(path);
    expect((await tailer.read())?.lines).toEqual([]);
    await appendFile(path, line.subarray(8));
    expect((await tailer.read())?.lines).toEqual(['{"t":"ação"}']);
  });

  test('starts near the end for big files and drops the first partial line', async () => {
    const path = join(dir, 'big.jsonl');
    const lines = Array.from({ length: 200 }, (_, i) => JSON.stringify({ i, pad: 'x'.repeat(40) }));
    await writeFile(path, `${lines.join('\n')}\n`);
    const result = await new JsonlTailer(path, { initialTailBytes: 1000 }).read();
    expect(result?.initial).toBe(true);
    const read = result?.lines ?? [];
    expect(read.length).toBeGreaterThan(5);
    expect(read.length).toBeLessThan(30);
    expect(read[read.length - 1]).toBe(lines[199]);
    expect(() => read.forEach((l) => JSON.parse(l))).not.toThrow();
  });

  test('detects truncation and restarts from the beginning', async () => {
    const path = join(dir, 't.jsonl');
    await writeFile(path, '{"a":1}\n{"a":2}\n');
    const tailer = new JsonlTailer(path);
    await tailer.read();
    await truncate(path, 0);
    await writeFile(path, '{"b":1}\n');
    const result = await tailer.read();
    expect(result).toMatchObject({ reset: true, lines: ['{"b":1}'] });
  });

  test('detects replacement of the file (rotation)', async () => {
    const path = join(dir, 'r.jsonl');
    await writeFile(path, '{"a":1}\n{"a":2}\n{"a":3}\n');
    const tailer = new JsonlTailer(path);
    await tailer.read();
    await rename(path, join(dir, 'old.jsonl'));
    await writeFile(path, '{"n":1}\n{"n":2}\n{"n":3}\n{"n":4}\n');
    const result = await tailer.read();
    expect(result?.reset).toBe(true);
    expect(result?.lines).toHaveLength(4);
  });

  test('skips blank lines', async () => {
    const path = join(dir, 'b.jsonl');
    await writeFile(path, '{"a":1}\n\n\n{"a":2}\n');
    expect((await new JsonlTailer(path).read())?.lines).toEqual(['{"a":1}', '{"a":2}']);
  });
});
