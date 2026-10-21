import { appendFile, writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { T0, assistantLine, jsonl, makeTempDir, removeDir, text, userLine } from '../test-helpers';
import type { DayWindow } from './accumulator';
import { type ReadBudget, readFileDay, seekDayStart } from './reader';

const HOUR = 3_600_000;
const DAY: DayWindow = { start: T0 - 6 * HOUR, end: T0 + 18 * HOUR };
const budget = (over: Partial<ReadBudget> = {}): ReadBudget => ({
  maxBytes: 512 * 1024 * 1024,
  deadline: Number.MAX_SAFE_INTEGER,
  now: () => 0,
  yieldTurn: async () => undefined,
  ...over,
});

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await makeTempDir('ai-office-report-');
  path = join(dir, 's1.jsonl');
});
afterEach(() => removeDir(dir));

/** `count` prompts spread from `from` with 1 s steps. */
const prompts = (count: number, from: number, label: string): string[] =>
  Array.from({ length: count }, (_, i) => userLine(`${label} ${i} ${'x'.repeat(40)}`, from + i * 1000));

async function stamp() {
  const info = await stat(path);
  return { size: info.size, mtimeMs: info.mtimeMs, ino: info.ino };
}

describe('seekDayStart', () => {
  test('a file that begins during the day starts at byte 0', async () => {
    await writeFile(path, jsonl(...prompts(5, 0, 'a')));
    const seek = await seekDayStart(path, (await stamp()).size, DAY);
    expect(seek).toEqual({ offset: 0, startedInDay: true });
  });

  test('skips most of a long earlier history without reading it from the top', async () => {
    await writeFile(path, jsonl(...prompts(4000, -3 * 24 * HOUR, 'old'), ...prompts(10, 0, 'today')));
    const size = (await stamp()).size;
    const seek = await seekDayStart(path, size, DAY);
    expect(seek.startedInDay).toBe(false);
    expect(seek.offset).toBeGreaterThan(size / 2);
    expect(seek.offset).toBeLessThan(size);
  });

  test('an empty or unreadable file yields offset 0', async () => {
    await writeFile(path, '');
    expect(await seekDayStart(path, 0, DAY)).toEqual({ offset: 0, startedInDay: false });
  });
});

describe('readFileDay', () => {
  test('counts only the lines of the day and stops at the end of the day', async () => {
    await writeFile(
      path,
      jsonl(...prompts(3000, -3 * 24 * HOUR, 'old'), ...prompts(7, 0, 'today'), ...prompts(4, 20 * HOUR, 'tomorrow')),
    );
    const state = await readFileDay(path, await stamp(), DAY, 'main', undefined, budget());
    expect(state.acc.result().prompts).toBe(7);
    expect(state.done).toBe(true);
    expect(state.truncated).toBe(false);
  });

  test('resumes after the file grows and returns the cached state when nothing changed', async () => {
    await writeFile(path, jsonl(...prompts(3, 0, 'a')));
    const first = await readFileDay(path, await stamp(), DAY, 'main', undefined, budget());
    expect(first.acc.result().prompts).toBe(3);
    const again = await readFileDay(path, await stamp(), DAY, 'main', first, budget());
    expect(again.acc).toBe(first.acc);
    await appendFile(path, jsonl(...prompts(2, 10_000, 'b'), assistantLine([text('ok')], 20_000)));
    const grown = await readFileDay(path, await stamp(), DAY, 'main', first, budget());
    expect(grown.acc.result().prompts).toBe(5);
  });

  test('reads a replaced file from scratch', async () => {
    await writeFile(path, jsonl(...prompts(6, 0, 'a')));
    const first = await readFileDay(path, await stamp(), DAY, 'main', undefined, budget());
    await writeFile(path, jsonl(...prompts(1, 0, 'b')));
    const second = await readFileDay(path, { ...(await stamp()), ino: first.ino + 1 }, DAY, 'main', first, budget());
    expect(second.acc.result().prompts).toBe(1);
  });

  test('stops at the byte budget and says the numbers are partial', async () => {
    await writeFile(path, jsonl(...prompts(30_000, 0, 'a')));
    const state = await readFileDay(path, await stamp(), DAY, 'main', undefined, budget({ maxBytes: 1 }));
    expect(state.truncated).toBe(true);
    expect(state.acc.result().prompts).toBeGreaterThan(0);
    expect(state.acc.result().prompts).toBeLessThan(30_000);
  });

  test('stops at the deadline', async () => {
    await writeFile(path, jsonl(...prompts(30_000, 0, 'a')));
    const state = await readFileDay(
      path,
      await stamp(),
      DAY,
      'main',
      undefined,
      budget({ now: () => 10, deadline: 5 }),
    );
    expect(state.truncated).toBe(true);
  });

  test('records the moments of the day only when asked, and a cached read without them is read again to get them', async () => {
    await writeFile(path, jsonl(...prompts(3, 0, 'a')));
    const plain = await readFileDay(path, await stamp(), DAY, 'main', undefined, budget());
    expect(plain.trace).toBeUndefined();
    const traced = await readFileDay(path, await stamp(), DAY, 'main', plain, budget(), { trace: true });
    expect(traced.trace?.result().firstAt).toBe(T0);
    expect(traced.acc).not.toBe(plain.acc);
    expect(traced.acc.result().prompts).toBe(3);
  });

  test('keeps feeding the moments of a cached read, even when a later read does not ask for them', async () => {
    await writeFile(path, jsonl(...prompts(3, 0, 'a')));
    const traced = await readFileDay(path, await stamp(), DAY, 'main', undefined, budget(), { trace: true });
    await appendFile(path, jsonl(...prompts(2, 10_000, 'b')));
    const grown = await readFileDay(path, await stamp(), DAY, 'main', traced, budget());
    expect(grown.trace).toBe(traced.trace);
    expect(grown.trace?.result().lastAt).toBe(T0 + 11_000);
    expect(grown.acc).toBe(traced.acc);
  });
});
